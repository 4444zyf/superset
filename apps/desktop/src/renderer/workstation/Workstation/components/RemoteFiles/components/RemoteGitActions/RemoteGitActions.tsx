import { Trans, useLingui } from "@lingui/react/macro";
import { Button } from "@superset/ui/button";
import { Input } from "@superset/ui/input";
import { type SetStateAction, useEffect, useId, useRef, useState } from "react";
import { CommitForm } from "renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/components/CommitForm/CommitForm";
import type {
	DirectDescriptor,
	DirectWorkstationApi,
} from "../../../../../../../shared/direct-workstation";

export function RemoteGitActions({
	api,
	connection,
	workspaceId,
	hasStagedChanges,
	disabled = false,
	onRefresh,
	onError,
}: {
	api: DirectWorkstationApi;
	connection: DirectDescriptor;
	workspaceId: string;
	hasStagedChanges: boolean;
	disabled?: boolean;
	onRefresh(): void | Promise<void>;
	onError(message: string): void;
}) {
	const { t } = useLingui();
	const [message, setMessage] = useState("");
	const [busy, setBusy] = useState(false);
	const [identity, setIdentity] = useState<{ configured: boolean } | null>(
		null,
	);
	const [identityName, setIdentityName] = useState("");
	const [identityEmail, setIdentityEmail] = useState("");
	const [identityDirty, setIdentityDirty] = useState(false);
	const identityDraftVersion = useRef(0);
	const identityRequestVersion = useRef(0);
	const errorCallback = useRef(onError);
	errorCallback.current = onError;
	const nameId = useId();
	const emailId = useId();
	const messageRef = useRef("");
	const busyRef = useRef(false);
	const scope = JSON.stringify([
		connection.connectionId,
		connection.backendId,
		connection.namespaceId,
		workspaceId,
	]);
	const operationScope = JSON.stringify([scope, connection.generation]);
	const draftOwner = useRef(scope);
	const lockOwner = useRef(operationScope);
	const currentScope = useRef(operationScope);
	currentScope.current = operationScope;
	useEffect(() => {
		if (draftOwner.current === scope) return;
		draftOwner.current = scope;
		messageRef.current = "";
		setMessage("");
	}, [scope]);
	useEffect(() => {
		if (lockOwner.current === operationScope) return;
		lockOwner.current = operationScope;
		busyRef.current = false;
		setBusy(false);
	}, [operationScope]);
	const available = connection.capabilities?.workstationGitV1 === true;
	const identityAvailable =
		connection.capabilities?.workstationGitIdentityV1 === true;
	useEffect(() => {
		setIdentity(null);
		setIdentityName("");
		setIdentityEmail("");
		setIdentityDirty(false);
		if (!identityAvailable) return;
		const owner = operationScope;
		const requestVersion = ++identityRequestVersion.current;
		const draftVersion = identityDraftVersion.current;
		let cancelled = false;
		void api
			.rpc<{ name: string | null; email: string | null; configured: boolean }>({
				connectionId: connection.connectionId,
				generation: connection.generation,
				path: "git.getUserIdentityV1",
				type: "query",
				input: { workspaceId },
			})
			.then((result) => {
				if (
					cancelled ||
					currentScope.current !== owner ||
					identityRequestVersion.current !== requestVersion
				)
					return;
				setIdentity({ configured: result.configured === true });
				if (identityDraftVersion.current === draftVersion) {
					setIdentityName(result.name ?? "");
					setIdentityEmail(result.email ?? "");
				}
			})
			.catch((error) => {
				if (
					!cancelled &&
					currentScope.current === owner &&
					identityRequestVersion.current === requestVersion
				)
					errorCallback.current(
						error instanceof Error ? error.message : String(error),
					);
			});
		return () => {
			cancelled = true;
		};
	}, [
		api,
		operationScope,
		identityAvailable,
		connection.connectionId,
		connection.generation,
		workspaceId,
	]);
	const canCommit =
		available &&
		connection.capabilities?.durableOperations === true &&
		hasStagedChanges &&
		(!identityAvailable || (identity?.configured === true && !identityDirty));
	const saveIdentity = async () => {
		if (
			!identityAvailable ||
			disabled ||
			busyRef.current ||
			!identityName.trim() ||
			!identityEmail.trim()
		)
			return;
		busyRef.current = true;
		setBusy(true);
		const owner = operationScope;
		const requestVersion = ++identityRequestVersion.current;
		const draftVersion = identityDraftVersion.current;
		try {
			const result = await api.rpc<{ configured: boolean }>({
				connectionId: connection.connectionId,
				generation: connection.generation,
				path: "git.setUserIdentityV1",
				type: "mutation",
				input: {
					workspaceId,
					name: identityName.trim(),
					email: identityEmail.trim(),
				},
			});
			if (
				currentScope.current !== owner ||
				identityRequestVersion.current !== requestVersion
			)
				return;
			setIdentity({ configured: result.configured === true });
			if (identityDraftVersion.current === draftVersion)
				setIdentityDirty(false);
		} catch (error) {
			if (currentScope.current === owner)
				onError(error instanceof Error ? error.message : String(error));
		} finally {
			if (currentScope.current === owner) {
				busyRef.current = false;
				setBusy(false);
			}
		}
	};
	const changeMessage = (next: SetStateAction<string>) => {
		const value = typeof next === "function" ? next(messageRef.current) : next;
		messageRef.current = value;
		setMessage(value);
	};
	const mutate = async (
		path: "git.stageAll" | "git.unstageAll" | "git.commit",
	) => {
		if (
			busyRef.current ||
			disabled ||
			!available ||
			(path === "git.commit" && (!canCommit || !messageRef.current.trim()))
		)
			return;
		busyRef.current = true;
		setBusy(true);
		const snapshot = messageRef.current;
		const epoch = operationScope;
		try {
			await api.rpc({
				connectionId: connection.connectionId,
				generation: connection.generation,
				path,
				type: "mutation",
				input: {
					workspaceId,
					...(path === "git.commit"
						? {
								operationId: crypto.randomUUID(),
								message: snapshot.trim(),
								stageAll: false,
							}
						: {}),
				},
			});
			if (currentScope.current !== epoch) return;
			if (path === "git.commit" && messageRef.current === snapshot)
				changeMessage("");
			await onRefresh();
		} catch (error) {
			if (currentScope.current === epoch)
				onError(error instanceof Error ? error.message : String(error));
		} finally {
			if (currentScope.current === epoch) {
				busyRef.current = false;
				setBusy(false);
			}
		}
	};
	return (
		<section className="space-y-2" aria-label={t({ message: "Git" })}>
			{identityAvailable && (
				<form
					className="space-y-2 rounded border border-border p-2"
					onSubmit={(event) => {
						event.preventDefault();
						void saveIdentity();
					}}
				>
					<p className="text-xs text-muted-foreground">
						<Trans>Git identity</Trans> · <Trans>Repository</Trans>
					</p>
					<div className="flex gap-2">
						<label htmlFor={nameId} className="flex-1 text-xs">
							<Trans>Name</Trans>
							<Input
								id={nameId}
								value={identityName}
								maxLength={256}
								disabled={busy}
								onChange={(event) => {
									identityDraftVersion.current++;
									setIdentityName(event.target.value);
									setIdentityDirty(true);
								}}
							/>
						</label>
						<label htmlFor={emailId} className="flex-1 text-xs">
							<Trans>Email</Trans>
							<Input
								id={emailId}
								type="email"
								value={identityEmail}
								maxLength={320}
								disabled={busy}
								onChange={(event) => {
									identityDraftVersion.current++;
									setIdentityEmail(event.target.value);
									setIdentityDirty(true);
								}}
							/>
						</label>
					</div>
					<Button
						type="submit"
						variant="outline"
						size="sm"
						disabled={
							disabled || busy || !identityName.trim() || !identityEmail.trim()
						}
					>
						<Trans>Save</Trans>
					</Button>
				</form>
			)}
			<div className="flex gap-2">
				<Button
					type="button"
					size="sm"
					variant="outline"
					disabled={!available || disabled || busy}
					onClick={() => void mutate("git.stageAll")}
				>
					<Trans>Stage all</Trans>
				</Button>
				<Button
					type="button"
					size="sm"
					variant="outline"
					disabled={!available || disabled || busy}
					onClick={() => void mutate("git.unstageAll")}
				>
					<Trans>Unstage all</Trans>
				</Button>
			</div>
			<CommitForm
				disabled={!canCommit || disabled || !message.trim()}
				actions={{
					commitMessage: message,
					setCommitMessage: changeMessage,
					defaultCommitMessage: t({ message: "Commit message" }),
					commit: () => void mutate("git.commit"),
					isCommitting: busy,
				}}
			/>
		</section>
	);
}

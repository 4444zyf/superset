import { Trans, useLingui } from "@lingui/react/macro";
import { Button } from "@superset/ui/button";
import { type SetStateAction, useEffect, useRef, useState } from "react";
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
	const canCommit =
		available &&
		connection.capabilities?.durableOperations === true &&
		hasStagedChanges;
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

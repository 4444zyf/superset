import { Trans } from "@lingui/react/macro";
import type { AppRouter } from "@superset/host-service";
import { Button } from "@superset/ui/button";
import type { inferRouterOutputs } from "@trpc/server";
import { useCallback, useEffect, useRef, useState } from "react";
import { PushButton } from "renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/components/ChangesControl/components/ShipControl/components/PushButton/PushButton";
import { RenameBranchDialogSurface } from "renderer/screens/main/components/WorkspaceSidebar/WorkspaceListItem/components/RenameBranchDialog/components/RenameBranchDialogSurface/RenameBranchDialogSurface";
import type {
	DirectDescriptor,
	DirectWorkstationApi,
} from "../../../../../../../shared/direct-workstation";

type Sync = inferRouterOutputs<AppRouter>["git"]["getBranchSyncStatus"];
export function RemoteBranchActions({
	api,
	connection,
	workspaceId,
	revision,
	disabled = false,
	onRefresh,
	onError,
}: {
	api: DirectWorkstationApi;
	connection: DirectDescriptor;
	workspaceId: string;
	revision?: unknown;
	disabled?: boolean;
	onRefresh(): void | Promise<void>;
	onError(message: string): void;
}) {
	const [sync, setSync] = useState<Sync | null>(null);
	const [open, setOpen] = useState(false);
	const [value, setValue] = useState("");
	const [busy, setBusy] = useState(false);
	const [loading, setLoading] = useState(true);
	const [uncertain, setUncertain] = useState(false);
	const [pushing, setPushing] = useState(false);
	const lock = useRef(false);
	const attemptedRename = useRef<string | null>(null);
	const epoch = useRef(0);
	const readVersion = useRef(0);
	const owner = JSON.stringify([
		connection.connectionId,
		connection.backendId,
		connection.namespaceId,
		connection.generation,
		workspaceId,
	]);
	const currentOwner = useRef(owner);
	currentOwner.current = owner;
	const latestRevision = useRef(revision);
	latestRevision.current = revision;
	const callbacks = useRef({ onRefresh, onError });
	callbacks.current = { onRefresh, onError };
	const available = connection.capabilities?.workstationGitV1 === true;
	const request = useCallback(
		<T,>(path: string, type: "query" | "mutation", input: unknown) =>
			api.rpc<T>({
				connectionId: connection.connectionId,
				generation: connection.generation,
				path,
				type,
				input,
			}),
		[api, connection.connectionId, connection.generation],
	);
	const load = useCallback(async () => {
		const version = epoch.current;
		const expectedOwner = owner;
		const read = ++readVersion.current;
		const result = await request<Sync>("git.getBranchSyncStatus", "query", {
			workspaceId,
		});
		if (
			epoch.current !== version ||
			currentOwner.current !== expectedOwner ||
			read !== readVersion.current
		)
			return null;
		setSync(result);
		return result;
	}, [request, owner, workspaceId]);
	useEffect(() => {
		if (currentOwner.current !== owner) return;
		epoch.current++;
		lock.current = false;
		attemptedRename.current = null;
		setOpen(false);
		setValue("");
		setSync(null);
		setBusy(false);
		setPushing(false);
		setUncertain(false);
		return () => {
			epoch.current++;
			readVersion.current++;
		};
	}, [owner]);
	useEffect(() => {
		if (!available) {
			setLoading(false);
			return;
		}
		let cancelled = false;
		const expectedOwner = owner;
		setLoading(true);
		void load()
			.catch((error) => {
				if (
					!cancelled &&
					currentOwner.current === expectedOwner &&
					latestRevision.current === revision
				)
					callbacks.current.onError(
						error instanceof Error ? error.message : String(error),
					);
			})
			.finally(() => {
				if (
					!cancelled &&
					currentOwner.current === expectedOwner &&
					latestRevision.current === revision
				)
					setLoading(false);
			});
		return () => {
			cancelled = true;
		};
	}, [available, load, owner, revision]);
	const valid = (version: number, expectedOwner: string) =>
		epoch.current === version && currentOwner.current === expectedOwner;
	const canRename =
		available && !!sync?.currentBranch && !sync.isDetached && !sync.hasUpstream;
	const canPush =
		available &&
		connection.capabilities?.durableOperations === true &&
		!!sync?.hasRepo &&
		!sync.isDetached &&
		(!sync.hasUpstream || sync.pushCount > 0);
	const mutate = async (path: "git.renameBranch" | "git.push") => {
		if (
			lock.current ||
			busy ||
			loading ||
			disabled ||
			uncertain ||
			(path === "git.renameBranch"
				? !canRename || !value.trim() || value.trim() === sync?.currentBranch
				: !canPush)
		)
			return;
		lock.current = true;
		setBusy(true);
		setPushing(path === "git.push");
		readVersion.current++;
		const version = epoch.current;
		const expectedOwner = owner;
		const newName = value.trim();
		let confirmed = false;
		if (path === "git.renameBranch") attemptedRename.current = newName;
		try {
			await request(
				path,
				"mutation",
				path === "git.renameBranch"
					? { workspaceId, oldName: sync?.currentBranch, newName }
					: { workspaceId, operationId: crypto.randomUUID() },
			);
			if (!valid(version, expectedOwner)) return;
			confirmed = true;
			if (path === "git.renameBranch") {
				setOpen(false);
				attemptedRename.current = null;
			}
			await load().catch((error) => {
				if (valid(version, expectedOwner))
					callbacks.current.onError(
						error instanceof Error ? error.message : String(error),
					);
			});
			if (valid(version, expectedOwner)) await callbacks.current.onRefresh();
		} catch (error) {
			if (!valid(version, expectedOwner)) return;
			callbacks.current.onError(
				error instanceof Error ? error.message : String(error),
			);
			if (path === "git.renameBranch" && !confirmed) {
				setUncertain(true);
				try {
					const actual = await load();
					if (!actual || !valid(version, expectedOwner)) return;
					setUncertain(false);
					attemptedRename.current = null;
					if (actual.currentBranch === newName) {
						setOpen(false);
						await callbacks.current.onRefresh();
					}
				} catch {}
			}
		} finally {
			if (valid(version, expectedOwner)) {
				lock.current = false;
				setBusy(false);
				setPushing(false);
			}
		}
	};
	const check = async () => {
		if (lock.current || disabled) return;
		lock.current = true;
		setBusy(true);
		const version = epoch.current;
		const expectedOwner = owner;
		try {
			const actual = await load();
			if (!actual || !valid(version, expectedOwner)) return;
			setUncertain(false);
			if (attemptedRename.current === actual.currentBranch) {
				setOpen(false);
				await callbacks.current.onRefresh();
			}
			attemptedRename.current = null;
		} catch (error) {
			if (valid(version, expectedOwner))
				callbacks.current.onError(
					error instanceof Error ? error.message : String(error),
				);
		} finally {
			if (valid(version, expectedOwner)) {
				lock.current = false;
				setBusy(false);
			}
		}
	};
	return (
		<div
			className="flex h-7 items-center gap-2 text-xs"
			data-branch-actions={workspaceId}
		>
			<code className="truncate">{sync?.currentBranch}</code>
			<Button
				size="sm"
				variant="ghost"
				disabled={disabled || busy || loading || !canRename}
				onClick={() => {
					setValue(sync?.currentBranch ?? "");
					setOpen(true);
				}}
			>
				<Trans>Rename branch</Trans>
			</Button>
			<PushButton
				className="flex h-full items-center gap-1.5 rounded border border-border px-2 text-xs font-medium enabled:hover:bg-accent/60 disabled:opacity-50"
				isPushing={pushing}
				disabled={disabled || busy || loading || uncertain || !canPush}
				onClick={() => void mutate("git.push")}
			/>
			{uncertain && !open && (
				<Button
					type="button"
					size="sm"
					variant="outline"
					disabled={busy || disabled}
					onClick={() => void check()}
				>
					<Trans>Refresh</Trans>
				</Button>
			)}
			<RenameBranchDialogSurface
				open={open}
				onOpenChange={(next) => {
					if (!lock.current) setOpen(next);
				}}
				currentBranchName={sync?.currentBranch ?? ""}
				value={value}
				onValueChange={setValue}
				isSubmitting={busy}
				disabled={disabled || loading || uncertain || !canRename}
				onSubmit={() => void mutate("git.renameBranch")}
				footer={
					uncertain ? (
						<Button
							type="button"
							variant="outline"
							disabled={busy || disabled}
							onClick={() => void check()}
						>
							<Trans>Refresh</Trans>
						</Button>
					) : undefined
				}
			/>
		</div>
	);
}

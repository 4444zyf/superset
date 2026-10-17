import { useLingui } from "@lingui/react/macro";
import type { AppRouter, TeardownFailureCause } from "@superset/host-service";
import { errorMessage } from "@superset/i18n/errors";
import type { inferRouterOutputs } from "@trpc/server";
import { useEffect, useRef, useState } from "react";
import { DestroyConfirmPane } from "renderer/components/WorkspaceDeleteDialog/DestroyConfirmPane/DestroyConfirmPane";
import { TeardownFailedPane } from "renderer/components/WorkspaceDeleteDialog/TeardownFailedPane/TeardownFailedPane";
import type {
	DirectDescriptor,
	DirectWorkstationApi,
	RemoteWorkspace,
} from "../../types";

type Inspection = inferRouterOutputs<AppRouter>["workspaceCleanup"]["inspect"];
type Result =
	inferRouterOutputs<AppRouter>["workspaceCleanup"]["destroyTrackedV1"];
interface State {
	owner: string;
	inspection?: Inspection;
	cause?: TeardownFailureCause;
	error?: string;
	pending: boolean;
	blocked: boolean;
	deleteBranch: boolean;
}
export function RemoteWorkspaceDelete({
	api,
	connection,
	workspace,
	onClose,
	onDeleted,
	hasUnsavedChanges,
}: {
	api: DirectWorkstationApi;
	connection: DirectDescriptor;
	workspace: RemoteWorkspace;
	onClose(): void;
	onDeleted(warnings: string[]): void;
	hasUnsavedChanges(): boolean;
}) {
	const { t } = useLingui();
	const owner = JSON.stringify([
		connection.connectionId,
		connection.backendId,
		connection.namespaceId,
		connection.generation,
		workspace.id,
	]);
	const scope = useRef({ owner, epoch: 0 });
	if (scope.current.owner !== owner)
		scope.current = { owner, epoch: scope.current.epoch + 1 };
	const epoch = scope.current.epoch;
	const mounted = useRef(false),
		busy = useRef<number | null>(null);
	const empty: State = {
		owner,
		pending: false,
		blocked: false,
		deleteBranch: false,
	};
	const [stored, setState] = useState<State>(empty);
	const state = stored.owner === owner ? stored : empty;
	const callbacks = useRef({ onClose, onDeleted, hasUnsavedChanges });
	callbacks.current = { onClose, onDeleted, hasUnsavedChanges };
	const capable =
		connection.capabilities?.workstationWorkspaceCleanupV1 === true &&
		connection.capabilities.durableOperations === true;
	const owned = () => mounted.current && scope.current.epoch === epoch;
	const rpc = <T,>(path: string, type: "query" | "mutation", input: unknown) =>
		api.rpc<T>({
			connectionId: connection.connectionId,
			generation: connection.generation,
			path,
			type,
			input,
		});
	useEffect(() => {
		mounted.current = true;
		let active = true;
		setState({ owner, pending: false, blocked: false, deleteBranch: false });
		if (capable)
			void rpc<Inspection>("workspaceCleanup.inspect", "query", {
				workspaceId: workspace.id,
			})
				.then((inspection) => {
					if (active && owned()) setState((s) => ({ ...s, inspection }));
				})
				.catch((error) => {
					if (active && owned())
						setState((s) => ({
							...s,
							error: errorMessage(error),
							blocked: true,
						}));
				});
		return () => {
			active = false;
			mounted.current = false;
		};
	}, [owner, capable]);
	const run = async (skipTeardown = false) => {
		if (
			!capable ||
			busy.current === epoch ||
			state.blocked ||
			!state.inspection?.canDelete
		)
			return;
		if (callbacks.current.hasUnsavedChanges()) {
			setState((s) => ({ ...s, error: t({ message: "Unsaved changes" }) }));
			return;
		}
		busy.current = epoch;
		setState((s) => ({ ...s, pending: true, error: undefined }));
		try {
			const result = await rpc<Result>(
				"workspaceCleanup.destroyTrackedV1",
				"mutation",
				{
					workspaceId: workspace.id,
					operationId: crypto.randomUUID(),
					deleteBranch: state.deleteBranch,
					force:
						skipTeardown ||
						state.inspection.hasChanges ||
						state.inspection.hasUnpushedCommits,
					skipTeardown,
				},
			);
			if (!owned()) return;
			if (result.outcome === "deleted") {
				callbacks.current.onDeleted(result.warnings);
				return;
			}
			if (result.outcome === "teardown-failed")
				setState((s) => ({ ...s, cause: result.cause }));
			else
				setState((s) => ({
					...s,
					cause: undefined,
					error: result.message,
					blocked: true,
				}));
		} catch (error) {
			if (owned())
				setState((s) => ({
					...s,
					cause: undefined,
					error: errorMessage(error),
					blocked: true,
				}));
		} finally {
			if (busy.current === epoch) busy.current = null;
			if (owned()) setState((s) => ({ ...s, pending: false }));
		}
	};
	const changeOpen = (open: boolean) => {
		if (!open && busy.current !== epoch) callbacks.current.onClose();
	};
	if (state.cause)
		return (
			<TeardownFailedPane
				open
				onOpenChange={changeOpen}
				cause={state.cause}
				canForceDelete={!state.pending && !state.blocked}
				onForceDelete={() => void run(true)}
			/>
		);
	const inspection = state.inspection;
	return (
		<DestroyConfirmPane
			open
			onOpenChange={changeOpen}
			workspaceName={workspace.name}
			isSession={!workspace.projectId}
			sharesProjectCheckout={inspection?.sharesProjectCheckout}
			deleteBranch={state.deleteBranch}
			onDeleteBranchChange={(deleteBranch) => {
				if (busy.current !== epoch) setState((s) => ({ ...s, deleteBranch }));
			}}
			hasChanges={inspection?.hasChanges ?? false}
			hasUnpushedCommits={inspection?.hasUnpushedCommits ?? false}
			canConfirm={
				capable &&
				inspection?.canDelete === true &&
				!state.pending &&
				!state.blocked
			}
			blockingReason={
				state.error ??
				(!capable
					? t({
							message: "This backend does not support the required capability",
						})
					: state.pending
						? t({ message: "In progress" })
						: (inspection?.reason ?? null))
			}
			onConfirm={() => void run()}
			confirmLabel={
				inspection?.hasChanges || inspection?.hasUnpushedCommits
					? t({ message: "Delete anyway" })
					: t({ message: "Delete" })
			}
		/>
	);
}

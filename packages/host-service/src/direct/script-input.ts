import type { DirectOperationStore } from "./operations";
export interface ScriptInputRef {
	workspaceId: string;
	resourceId: string;
	executionId: string;
}
export function observeScriptInput(
	operations: DirectOperationStore,
	ref: ScriptInputRef,
	data: string,
	cancelQueued: (terminalId: string, workspaceId: string) => unknown,
): void {
	if (data !== "\x03") return;
	const run = operations.workspaceRuns.get(ref.workspaceId);
	if (
		run &&
		run.terminalId === ref.resourceId &&
		(!run.executionId || run.executionId === ref.executionId) &&
		run.state !== "ended"
	) {
		cancelQueued(ref.resourceId, ref.workspaceId);
		operations.workspaceRuns.update(run, {
			state: "stop-requested",
			executionId: ref.executionId,
		});
	}
	const setup = operations.workspaceSetups.get(ref.workspaceId);
	if (
		setup &&
		setup.terminalId === ref.resourceId &&
		(!setup.executionId || setup.executionId === ref.executionId) &&
		!["succeeded", "failed", "cancelled"].includes(setup.phase)
	) {
		cancelQueued(ref.resourceId, ref.workspaceId);
		operations.workspaceSetups.update(setup, {
			cancelRequested: true,
			executionId: ref.executionId,
		});
	}
}

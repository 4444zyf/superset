import { preserveLocalPaneSelection } from "renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/hooks/useV2WorkspacePaneLayout/utils/preserveLocalPaneSelection";
import type { WorkspaceViewSnapshotV2 } from "shared/workspace-view-v2";
import { toPaneState } from "../pane-adapter/pane-adapter";
import { applyWorkspacePaneState } from "../workspace-pane-state/workspace-pane-state";
export function preserveBrowserOpenSelection(
	current: WorkspaceViewSnapshotV2 | null,
	saved: WorkspaceViewSnapshotV2,
	connectionId: string,
	workspaceId: string,
	show: boolean,
	preserveOtherTargets = false,
): WorkspaceViewSnapshotV2 {
	if (!current) return saved;
	if (current.revision > saved.revision) return current;
	const merged = structuredClone(saved);
	for (const target of current.targets) {
		const next = saved.targets.find(
			(item) => item.connectionId === target.connectionId,
		);
		if (
			next &&
			(next.backendId !== target.backendId ||
				next.namespaceId !== target.namespaceId ||
				next.serviceUid !== target.serviceUid ||
				next.targetRevision !== target.targetRevision)
		)
			throw Error("Workspace view identity changed");
	}

	for (const latest of current.targets) {
		const target = merged.targets.find(
			(item) =>
				item.connectionId === latest.connectionId &&
				item.backendId === latest.backendId &&
				item.namespaceId === latest.namespaceId,
		);
		if (!target) continue;
		if (target.connectionId !== connectionId) {
			if (preserveOtherTargets) Object.assign(target, structuredClone(latest));
			continue;
		}
		if (show) continue;
		if (
			latest.activeTabId === null ||
			target.workspaces.some(
				(workspace) => workspace.tabId === latest.activeTabId,
			)
		)
			target.activeTabId = latest.activeTabId;
		for (const workspace of target.workspaces) {
			const before = latest.workspaces.find(
				(item) =>
					item.tabId === workspace.tabId &&
					item.workspaceId === workspace.workspaceId,
			);
			if (!before) continue;
			if (workspace.workspaceId !== workspaceId) {
				if (preserveOtherTargets)
					Object.assign(workspace, structuredClone(before));
				continue;
			}
			const state = toPaneState(workspace),
				selection = preserveLocalPaneSelection(toPaneState(before), state);
			if (!applyWorkspacePaneState(workspace, selection, state))
				throw Error("Browser open selection changed");
		}
	}
	if (
		!show &&
		(current.activeConnectionId === null ||
			merged.targets.some(
				(target) => target.connectionId === current.activeConnectionId,
			))
	)
		merged.activeConnectionId = current.activeConnectionId;
	return merged;
}

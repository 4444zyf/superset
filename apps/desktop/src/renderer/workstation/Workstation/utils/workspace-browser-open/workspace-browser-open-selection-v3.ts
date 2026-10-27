import { preserveLocalPaneSelection } from "renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/hooks/useV2WorkspacePaneLayout/utils/preserveLocalPaneSelection";
import {
	validateWorkspaceViewV3,
	type WorkspaceViewSnapshotV3,
	type WorkspaceViewV3,
} from "shared/workspace-view-v3";
import {
	readWorkspacePaneAreas,
	selectedWorkspacePane,
} from "../workspace-pane-areas/workspace-pane-areas";

function preserveWorkspaceSelection(
	before: WorkspaceViewV3,
	saved: WorkspaceViewV3,
): void {
	const previous = readWorkspacePaneAreas(before),
		next = readWorkspacePaneAreas(saved);
	const center = preserveLocalPaneSelection(previous.center, next.center);
	const right = preserveLocalPaneSelection(previous.right, next.right);
	const selections = (
		tabs: NonNullable<WorkspaceViewV3["paneTabs"]>,
		state: typeof center,
	) =>
		tabs.map((tab) => ({
			...tab,
			activePaneId:
				state.tabs.find((item) => item.id === tab.tabId)?.activePaneId ??
				tab.activePaneId,
		}));
	if (saved.paneTabs) {
		saved.paneTabs = selections(saved.paneTabs, center);
		saved.activePaneTabId = center.activeTabId;
	}
	const rightLayout = saved.rightPaneLayout;
	if (rightLayout) {
		saved.rightPaneLayout = {
			...rightLayout,
			tabs: selections(rightLayout.tabs, right),
			activeTabId: right.activeTabId,
		};
		saved.rightPaneOpen = previous.rightPaneOpen;
		saved.activePaneArea =
			previous.activePaneArea === "right" &&
			saved.rightPaneOpen &&
			right.activeTabId
				? "right"
				: "center";
	}
	saved.activePaneId = selectedWorkspacePane(
		saved.activePaneArea === "right" ? right : center,
	);
	saved.activeTool = before.activeTool;
}
export function preserveBrowserOpenSelectionV3(
	current: WorkspaceViewSnapshotV3 | null,
	saved: WorkspaceViewSnapshotV3,
	connectionId: string,
	workspaceId: string,
	show: boolean,
	preserveOtherTargets = false,
): WorkspaceViewSnapshotV3 {
	if (!current) return saved;
	if (current.revision > saved.revision) return current;
	const merged = structuredClone(saved);
	for (const latest of current.targets) {
		const target = merged.targets.find(
			(item) => item.connectionId === latest.connectionId,
		);
		if (!target) continue;
		if (
			target.backendId !== latest.backendId ||
			target.namespaceId !== latest.namespaceId ||
			target.serviceUid !== latest.serviceUid ||
			target.targetRevision !== latest.targetRevision
		)
			throw Error("Workspace view identity changed");
		if (target.connectionId !== connectionId) {
			if (preserveOtherTargets) Object.assign(target, structuredClone(latest));
			continue;
		}
		if (show) continue;
		if (
			latest.activeTabId === null ||
			target.workspaces.some((w) => w.tabId === latest.activeTabId)
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
			preserveWorkspaceSelection(before, workspace);
		}
	}
	if (
		!show &&
		(current.activeConnectionId === null ||
			merged.targets.some((t) => t.connectionId === current.activeConnectionId))
	)
		merged.activeConnectionId = current.activeConnectionId;
	const { schemaVersion: _, revision, updatedAt, ...view } = merged;
	return {
		...validateWorkspaceViewV3(view),
		schemaVersion: 3,
		revision,
		updatedAt,
	};
}

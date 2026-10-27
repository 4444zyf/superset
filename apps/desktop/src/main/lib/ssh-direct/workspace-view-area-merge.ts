import type { PaneTree } from "../../../shared/workspace-view";
import {
	validateWorkspaceViewV2,
	type WorkspaceViewInputV2,
} from "../../../shared/workspace-view-v2";
import {
	projectWorkspaceViewV2,
	validateWorkspaceViewV3,
	type WorkspaceViewInputV3,
	type WorkspaceViewV3,
} from "../../../shared/workspace-view-v3";

type Tab = NonNullable<WorkspaceViewV3["paneTabs"]>[number];
function members(layout: PaneTree): string[] {
	return layout.type === "pane"
		? [layout.paneId]
		: [...members(layout.first), ...members(layout.second)];
}
function tabsFor(workspace: WorkspaceViewV3): Tab[] {
	if (workspace.paneTabs) return workspace.paneTabs;
	if (!workspace.layout) return [];
	return [
		{
			tabId: workspace.tabId,
			label: workspace.label,
			createdAt: 0,
			activePaneId:
				workspace.activePaneId ?? members(workspace.layout)[0] ?? null,
			layout: workspace.layout,
		},
	];
}
function mergeWorkspace(
	previous: WorkspaceViewV3,
	incoming: WorkspaceViewV3,
	projected: WorkspaceViewV3,
): WorkspaceViewV3 {
	const panes = incoming.panes.map((pane) => {
		const original = previous.panes.find(
			(item) =>
				item.paneId === pane.paneId &&
				item.kind === pane.kind &&
				item.resourceId === pane.resourceId &&
				item.executionId === pane.executionId,
		);
		return original?.pinned === undefined
			? pane
			: { ...pane, pinned: original.pinned };
	});
	const right = previous.rightPaneLayout;
	if (!right) return { ...incoming, panes };
	const centerIds = new Set(previous.paneTabs?.map((tab) => tab.tabId));
	const rightIds = new Set(right.tabs.map((tab) => tab.tabId));
	const rightMembers = new Set(
		right.tabs.flatMap((tab) => members(tab.layout)),
	);
	const groups = tabsFor(incoming).map((tab) => ({
		tab,
		area:
			rightIds.has(tab.tabId) ||
			(!centerIds.has(tab.tabId) &&
				members(tab.layout).every((id) => rightMembers.has(id)))
				? ("right" as const)
				: ("center" as const),
	}));
	const focusChanged =
		incoming.activePaneId !== projected.activePaneId ||
		incoming.activePaneTabId !== projected.activePaneTabId;
	const focusedPaneId = focusChanged
		? incoming.activePaneId
		: previous.activePaneId;
	const focused = groups.find(
		(group) =>
			focusedPaneId !== null &&
			members(group.tab.layout).includes(focusedPaneId),
	);
	const centerTabs = groups
		.filter((group) => group.area === "center")
		.map((group) => group.tab);
	const rightTabs = groups
		.filter((group) => group.area === "right")
		.map((group) => group.tab);
	const centerTab =
		focused?.area === "center"
			? focused.tab
			: (centerTabs.find((tab) => tab.tabId === previous.activePaneTabId) ??
				centerTabs[0]);
	const rightTab =
		focused?.area === "right"
			? focused.tab
			: (rightTabs.find((tab) => tab.tabId === right.activeTabId) ??
				rightTabs[0]);
	const inRight = focused?.area === "right";
	return {
		...incoming,
		panes,
		paneTabs: centerTabs,
		activePaneTabId: centerTab?.tabId ?? null,
		rightPaneLayout: {
			version: 1,
			tabs: rightTabs,
			activeTabId: rightTab?.tabId ?? null,
		},
		...(inRight || previous.rightPaneOpen !== undefined
			? { rightPaneOpen: inRight || previous.rightPaneOpen }
			: {}),
		...(inRight || previous.activePaneArea !== undefined
			? { activePaneArea: inRight ? "right" : "center" }
			: {}),
		activePaneId: (inRight ? rightTab : centerTab)?.activePaneId ?? null,
	};
}

export function mergeLegacyWorkspaceViewAreas(
	previous: WorkspaceViewInputV3,
	incoming: WorkspaceViewInputV2,
): WorkspaceViewInputV3 {
	const projection = projectWorkspaceViewV2(previous),
		next = validateWorkspaceViewV2(incoming);
	return validateWorkspaceViewV3({
		...next,
		targets: next.targets.map((target) => {
			const originalTarget = previous.targets.find(
				(item) => item.connectionId === target.connectionId,
			);
			return {
				...target,
				workspaces: target.workspaces.map((workspace) => {
					const original = originalTarget?.workspaces.find(
						(item) => item.workspaceId === workspace.workspaceId,
					);
					if (
						!original ||
						(!original.rightPaneLayout &&
							!original.panes.some((pane) => pane.pinned !== undefined))
					)
						return workspace;
					if (
						originalTarget?.backendId !== target.backendId ||
						originalTarget.namespaceId !== target.namespaceId ||
						originalTarget.serviceUid !== target.serviceUid
					)
						throw new Error("Workspace identity requires V3");
					const projected = projection.targets
						.find((item) => item.connectionId === target.connectionId)
						?.workspaces.find(
							(item) => item.workspaceId === workspace.workspaceId,
						);
					if (!projected) throw new Error("Workspace layout requires V3");
					return mergeWorkspace(original, workspace, projected);
				}),
			};
		}),
	});
}

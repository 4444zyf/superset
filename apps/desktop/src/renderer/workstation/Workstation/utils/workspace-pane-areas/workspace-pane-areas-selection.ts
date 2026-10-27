import type { WorkspaceViewV2 } from "../../../../../shared/workspace-view-v2";
import type { WorkspaceViewV3 } from "../../../../../shared/workspace-view-v3";
import { fromPaneLayout } from "../pane-adapter/pane-adapter";
import { applyWorkspacePaneState } from "../workspace-pane-state/workspace-pane-state";
import {
	selectedWorkspacePane,
	stateForLegacyMetadataMerge,
	type WorkspacePaneArea,
	type WorkspacePaneAreasState,
	workspacePaneAreasStructureKey,
} from "./workspace-pane-areas";

type Tabs = NonNullable<WorkspaceViewV3["paneTabs"]>;
export function mergePaneAreaValue<T>(current: T, before: T, next: T): T {
	const key = (value: T) => JSON.stringify(value);
	if (key(next) === key(before)) return current;
	if (key(current) === key(before) || key(current) === key(next)) return next;
	throw new Error("Pane area changed in another edit");
}
export function mergePaneAreaSelections(
	workspace: WorkspaceViewV3,
	current: WorkspacePaneAreasState,
	next: WorkspacePaneAreasState,
	before: WorkspacePaneAreasState,
	centerTabs: Tabs,
	rightTabs: Tabs,
	panes: WorkspaceViewV3["panes"],
): WorkspaceViewV3 {
	const centerId = mergePaneAreaValue(
		current.center.activeTabId,
		before.center.activeTabId,
		next.center.activeTabId,
	);
	const rightId = mergePaneAreaValue(
		current.right.activeTabId,
		before.right.activeTabId,
		next.right.activeTabId,
	);
	const open = mergePaneAreaValue(
		current.rightPaneOpen,
		before.rightPaneOpen,
		next.rightPaneOpen,
	);
	let active = mergePaneAreaValue(
		current.activePaneArea,
		before.activePaneArea,
		next.activePaneArea,
	);
	if (!open || !rightTabs.length) active = "center";
	const focused = (active === "right" ? rightTabs : centerTabs).find(
		(tab) => tab.tabId === (active === "right" ? rightId : centerId),
	);
	const centerFocusChanged =
		before.center.activeTabId !== next.center.activeTabId ||
		selectedWorkspacePane(before.center) !== selectedWorkspacePane(next.center);
	const pane = panes.find((pane) => pane.paneId === focused?.activePaneId);
	return {
		...workspace,
		panes,
		paneTabs: centerTabs,
		activePaneTabId: centerId,
		rightPaneLayout: { version: 1, tabs: rightTabs, activeTabId: rightId },
		rightPaneOpen: open,
		activePaneArea: active,
		activePaneId: focused?.activePaneId ?? null,
		activeTool:
			active === "center" && centerFocusChanged && pane
				? pane.kind === "browser"
					? "terminal"
					: pane.kind
				: workspace.activeTool,
	};
}
export function mergePaneAreaSelectionOnly(
	workspace: WorkspaceViewV3,
	projected: WorkspaceViewV2,
	current: WorkspacePaneAreasState,
	next: WorkspacePaneAreasState,
	before: WorkspacePaneAreasState,
): WorkspaceViewV3 | null {
	const previousStructure = workspacePaneAreasStructureKey(before);
	if (
		workspacePaneAreasStructureKey(next) !== previousStructure ||
		workspacePaneAreasStructureKey(current) === previousStructure
	)
		return null;
	for (const area of ["center", "right"] as const) {
		for (const old of before[area].tabs) {
			const saved = current[area].tabs.find(
				(tab) => tab.id === old.id && tab.createdAt === old.createdAt,
			);
			if (!saved) return null;
			for (const pane of Object.values(old.panes)) {
				const known = saved.panes[pane.id];
				if (
					!known ||
					known.kind !== pane.kind ||
					known.data.resourceId !== pane.data.resourceId ||
					known.data.executionId !== pane.data.executionId
				)
					return null;
			}
		}
	}
	if (
		!applyWorkspacePaneState(
			structuredClone(projected),
			stateForLegacyMetadataMerge(before),
			stateForLegacyMetadataMerge(current),
		)
	)
		return null;
	const update = (tabs: Tabs, area: WorkspacePaneArea) =>
		tabs.map((tab) => {
			const old = before[area].tabs.find((item) => item.id === tab.tabId),
				requested = next[area].tabs.find((item) => item.id === tab.tabId);
			return old && requested
				? {
						...tab,
						activePaneId: mergePaneAreaValue(
							tab.activePaneId,
							old.activePaneId,
							requested.activePaneId,
						),
					}
				: tab;
		});
	const center =
		workspace.paneTabs ??
		current.center.tabs.map((tab) => ({
			tabId: tab.id,
			label: tab.titleOverride,
			createdAt: tab.createdAt,
			activePaneId: tab.activePaneId,
			layout: fromPaneLayout(tab.layout),
		}));
	return mergePaneAreaSelections(
		workspace,
		current,
		next,
		before,
		update(center, "center"),
		update(workspace.rightPaneLayout?.tabs ?? [], "right"),
		workspace.panes,
	);
}

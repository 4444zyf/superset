import type { WorkspaceViewInputV3 } from "../../../../../shared/workspace-view-v3";
import {
	projectWorkspaceViewV2,
	validateWorkspaceViewV3,
} from "../../../../../shared/workspace-view-v3";
import { fromPaneLayout } from "../pane-adapter/pane-adapter";
import { applyWorkspacePaneState } from "../workspace-pane-state/workspace-pane-state";
import {
	readWorkspacePaneAreas,
	type WorkspacePaneArea,
	type WorkspacePaneAreasState,
} from "./workspace-pane-areas";

type Target = WorkspaceViewInputV3["targets"][number];
type State = WorkspacePaneAreasState["center"];
export type WorkspacePaneAreasScope = Pick<
	Target,
	"connectionId" | "backendId" | "namespaceId" | "serviceUid" | "targetRevision"
> & { workspaceId: string; tabId: string };

function merge<T>(current: T, before: T, next: T): T {
	const key = (value: T) => JSON.stringify(value);
	if (key(next) === key(before)) return current;
	if (key(current) === key(before) || key(current) === key(next)) return next;
	throw new Error("Pane area changed in another edit");
}
function stateForLegacyMetadataMerge(state: WorkspacePaneAreasState): State {
	const tabs = [...state.center.tabs, ...state.right.tabs].sort((a, b) =>
		a.id.localeCompare(b.id),
	);
	return { version: 1, tabs, activeTabId: tabs[0]?.id ?? null };
}
function membership(
	state: WorkspacePaneAreasState,
): Map<string, WorkspacePaneArea> {
	return new Map([
		...state.center.tabs.map((tab) => [tab.id, "center"] as const),
		...state.right.tabs.map((tab) => [tab.id, "right"] as const),
	]);
}
function pinValues(
	state: WorkspacePaneAreasState,
): Map<string, boolean | undefined> {
	return new Map(
		[state.center, state.right].flatMap((area) =>
			area.tabs.flatMap((tab) =>
				Object.values(tab.panes).map((pane) => [pane.id, pane.pinned] as const),
			),
		),
	);
}
function selectedPane(state: State): string | null {
	return (
		state.tabs.find((tab) => tab.id === state.activeTabId)?.activePaneId ?? null
	);
}

export function applyWorkspacePaneAreas(
	value: WorkspaceViewInputV3,
	scope: WorkspacePaneAreasScope,
	next: WorkspacePaneAreasState,
	before: WorkspacePaneAreasState,
): WorkspaceViewInputV3 | null {
	try {
		const view = validateWorkspaceViewV3(value);
		const target = view.targets.find(
			(item) => item.connectionId === scope.connectionId,
		);
		if (
			!target ||
			(
				["backendId", "namespaceId", "serviceUid", "targetRevision"] as const
			).some((key) => target[key] !== scope[key])
		)
			return null;
		const index = target.workspaces.findIndex(
			(w) => w.workspaceId === scope.workspaceId && w.tabId === scope.tabId,
		);
		const workspace = target.workspaces[index];
		if (!workspace) return null;
		const current = readWorkspacePaneAreas(workspace),
			currentFlat = stateForLegacyMetadataMerge(current);
		const projected = projectWorkspaceViewV2(view)
			.targets.find((item) => item.connectionId === scope.connectionId)
			?.workspaces.find((w) => w.workspaceId === scope.workspaceId);
		if (!projected) return null;
		projected.paneTabs = currentFlat.tabs.map((tab) => ({
			tabId: tab.id,
			label: tab.titleOverride,
			createdAt: tab.createdAt,
			activePaneId: tab.activePaneId,
			layout: fromPaneLayout(tab.layout),
		}));
		projected.activePaneTabId = currentFlat.activeTabId;
		projected.activePaneId = selectedPane(currentFlat);
		if (
			!applyWorkspacePaneState(
				projected,
				stateForLegacyMetadataMerge(next),
				stateForLegacyMetadataMerge(before),
			)
		)
			return null;
		const savedTabs = projected.paneTabs ?? [];
		const currentMembers = membership(current),
			beforeMembers = membership(before),
			nextMembers = membership(next);
		const members = new Map(
			savedTabs.map((tab) => {
				const area = merge(
					currentMembers.get(tab.tabId),
					beforeMembers.get(tab.tabId),
					nextMembers.get(tab.tabId),
				);
				if (!area) throw new Error("Pane area membership is missing");
				return [tab.tabId, area] as const;
			}),
		);
		const ordered = (area: WorkspacePaneArea) => {
			const ids = (state: WorkspacePaneAreasState) =>
				state[area].tabs
					.filter((tab) => members.get(tab.id) === area)
					.map((tab) => tab.id);
			const order = merge(ids(current), ids(before), ids(next));
			const expected = savedTabs.filter(
				(tab) => members.get(tab.tabId) === area,
			);
			if (
				order.length !== expected.length ||
				new Set(order).size !== expected.length
			)
				throw new Error("Pane area order changed");
			return order.map((id) => {
				const tab = expected.find((tab) => tab.tabId === id);
				if (!tab) throw new Error("Pane area tab is unavailable");
				return tab;
			});
		};
		const centerTabs = ordered("center"),
			rightTabs = ordered("right");
		const centerId = merge(
			current.center.activeTabId,
			before.center.activeTabId,
			next.center.activeTabId,
		);
		const rightId = merge(
			current.right.activeTabId,
			before.right.activeTabId,
			next.right.activeTabId,
		);
		const open = merge(
			current.rightPaneOpen,
			before.rightPaneOpen,
			next.rightPaneOpen,
		);
		let active = merge(
			current.activePaneArea,
			before.activePaneArea,
			next.activePaneArea,
		);
		if (!open || !rightTabs.length) active = "center";
		const focused = (active === "right" ? rightTabs : centerTabs).find(
			(tab) => tab.tabId === (active === "right" ? rightId : centerId),
		);
		const currentPins = new Map(
				workspace.panes.map((pane) => [pane.paneId, pane.pinned]),
			),
			beforePins = pinValues(before),
			nextPins = pinValues(next);
		const panes = projected.panes.map((pane) => ({
			...pane,
			pinned: merge(
				currentPins.get(pane.paneId),
				beforePins.get(pane.paneId),
				nextPins.get(pane.paneId),
			),
		}));
		const centerFocusChanged =
			before.center.activeTabId !== next.center.activeTabId ||
			selectedPane(before.center) !== selectedPane(next.center);
		const pane = panes.find((pane) => pane.paneId === focused?.activePaneId);
		target.workspaces[index] = {
			...projected,
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
		return validateWorkspaceViewV3(view);
	} catch {
		return null;
	}
}

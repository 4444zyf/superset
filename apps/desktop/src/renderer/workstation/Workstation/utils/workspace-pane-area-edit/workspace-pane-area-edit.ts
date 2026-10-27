import {
	validateWorkspaceViewV3,
	type WorkspaceViewInputV3,
	type WorkspaceViewV3,
} from "shared/workspace-view-v3";
import { fromPaneLayout } from "../pane-adapter/pane-adapter";
import { buildPaneTree } from "../pane-layout/pane-layout";
import {
	readWorkspacePaneAreas,
	selectedWorkspacePane,
	type WorkspacePaneArea,
} from "../workspace-pane-areas/workspace-pane-areas";
import type { WorkspacePaneAreasScope } from "../workspace-pane-areas/workspace-pane-areas-state";
export interface WorkspacePaneAreaEdit {
	area?: WorkspacePaneArea;
	paneId?: string;
	paneTabId?: string;
	resource?: {
		kind: WorkspaceViewV3["panes"][number]["kind"];
		resourceId: string;
		replaceResourceId?: string;
	};
	focus?: boolean;
	ignoreMissing?: boolean;
	connectionId?: string;
}
export function workspacePaneAreaForEdit(
	workspace: WorkspaceViewV3,
	selection: WorkspacePaneAreaEdit,
): WorkspacePaneArea | null {
	if (selection.area) return selection.area;
	const states = readWorkspacePaneAreas(workspace);
	const resource = selection.resource;
	const pane = resource
		? workspace.panes.find(
				(p) =>
					p.kind === resource.kind &&
					(p.resourceId === resource.resourceId ||
						(!!resource.replaceResourceId &&
							p.resourceId === resource.replaceResourceId)),
			)
		: undefined;
	const paneId = pane?.paneId ?? selection.paneId;
	if (paneId || selection.paneTabId) {
		for (const area of ["center", "right"] as const) {
			if (
				states[area].tabs.some((tab) =>
					paneId ? !!tab.panes[paneId] : tab.id === selection.paneTabId,
				)
			)
				return area;
		}
		return null;
	}
	return states.activePaneArea;
}
export function projectWorkspacePaneArea(
	workspace: WorkspaceViewV3,
	area: WorkspacePaneArea,
): WorkspaceViewV3 {
	const state = readWorkspacePaneAreas(workspace)[area],
		ids = new Set(state.tabs.flatMap((tab) => Object.keys(tab.panes)));
	const {
		rightPaneLayout: _,
		rightPaneOpen: __,
		activePaneArea: ___,
		...legacy
	} = structuredClone(workspace);
	return {
		...legacy,
		panes: legacy.panes.filter((p) => ids.has(p.paneId)),
		layout: buildPaneTree([...ids]),
		paneTabs: state.tabs.map((tab) => ({
			tabId: tab.id,
			label: tab.titleOverride,
			createdAt: tab.createdAt,
			activePaneId: tab.activePaneId,
			layout: fromPaneLayout(tab.layout),
		})),
		activePaneTabId: state.activeTabId,
		activePaneId: selectedWorkspacePane(state),
	};
}
export function editWorkspacePaneArea(
	value: WorkspaceViewInputV3,
	scope: WorkspacePaneAreasScope,
	selection: WorkspacePaneAreaEdit,
	change: (workspace: WorkspaceViewV3) => void,
): WorkspaceViewInputV3 | null {
	try {
		const view = validateWorkspaceViewV3(value),
			target = view.targets.find((t) => t.connectionId === scope.connectionId);
		if (
			!target ||
			(
				["backendId", "namespaceId", "serviceUid", "targetRevision"] as const
			).some((key) => target[key] !== scope[key])
		)
			return null;
		const index = target.workspaces.findIndex(
				(w) => w.workspaceId === scope.workspaceId && w.tabId === scope.tabId,
			),
			workspace = target.workspaces[index];
		if (!workspace) return null;
		const area = workspacePaneAreaForEdit(workspace, selection);
		if (!area) return selection.ignoreMissing ? view : null;
		const projected = projectWorkspacePaneArea(workspace, area),
			states = readWorkspacePaneAreas(workspace),
			other = area === "center" ? "right" : "center";
		change(projected);
		const old = new Map(workspace.panes.map((p) => [p.paneId, p])),
			order = new Map(workspace.panes.map((p, index) => [p.paneId, index]));
		const panes = projected.panes.map((pane) => {
			const before = old.get(pane.paneId),
				{ pinned: _, ...plain } = pane;
			return before &&
				before.kind === pane.kind &&
				before.resourceId === pane.resourceId &&
				before.executionId === pane.executionId &&
				before.pinned !== undefined
				? { ...plain, pinned: before.pinned }
				: plain;
		});
		const otherIds = new Set(
			states[other].tabs.flatMap((tab) => Object.keys(tab.panes)),
		);
		panes.push(...workspace.panes.filter((p) => otherIds.has(p.paneId)));
		panes.sort(
			(a, b) =>
				(order.get(a.paneId) ?? order.size) -
				(order.get(b.paneId) ?? order.size),
		);
		const originalCenter = projectWorkspacePaneArea(workspace, "center"),
			originalRight = projectWorkspacePaneArea(workspace, "right");
		const center = area === "center" ? projected : originalCenter,
			right = area === "right" ? projected : originalRight;
		const focus = selection.focus !== false;
		const rightPaneOpen =
			area === "right" && focus ? true : states.rightPaneOpen;
		let activePaneArea = focus ? area : states.activePaneArea;
		if (
			activePaneArea === "right" &&
			(!rightPaneOpen || !right.paneTabs?.length)
		)
			activePaneArea = "center";
		const active = activePaneArea === "right" ? right : center;
		target.workspaces[index] = {
			...workspace,
			panes,
			layout: buildPaneTree(panes.map((p) => p.paneId)),
			paneTabs: center.paneTabs,
			activePaneTabId: center.activePaneTabId,
			rightPaneLayout: {
				version: 1,
				tabs: right.paneTabs ?? [],
				activeTabId: right.activePaneTabId ?? null,
			},
			rightPaneOpen,
			activePaneArea,
			activePaneId:
				active.paneTabs?.find((tab) => tab.tabId === active.activePaneTabId)
					?.activePaneId ?? null,
			activeTool:
				area === "center" && focus
					? projected.activeTool
					: workspace.activeTool,
		};
		return validateWorkspaceViewV3(view);
	} catch {
		return null;
	}
}

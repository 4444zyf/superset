import type { LayoutNode, WorkspaceState } from "@superset/panes";
import type {
	WorkspacePane,
	WorkspaceView,
} from "../../../../../shared/workspace-view";
import { fromPaneLayout, toPaneState } from "../pane-adapter/pane-adapter";
import { buildPaneTree } from "../pane-layout/pane-layout";

export function paneStateMetadataKey(
	state: WorkspaceState<WorkspacePane>,
): string {
	return JSON.stringify({
		activeTabId: state.activeTabId,
		tabs: state.tabs.map((tab) => ({
			id: tab.id,
			title: tab.titleOverride,
			createdAt: tab.createdAt,
			activePaneId: tab.activePaneId,
			panes: Object.values(tab.panes)
				.sort((a, b) => a.id.localeCompare(b.id))
				.map((p) => [
					p.id,
					p.kind,
					p.titleOverride,
					p.data.resourceId,
					p.data.executionId,
				]),
		})),
	});
}
function layoutMembers(
	node: LayoutNode,
	depth = 1,
	result = new Set<string>(),
): Set<string> {
	if (depth > 16) throw new Error("Terminal tab layout is too deep");
	if (node.type === "split") {
		layoutMembers(node.first, depth + 1, result);
		layoutMembers(node.second, depth + 1, result);
	} else {
		if (result.has(node.paneId)) throw new Error("Duplicate terminal tab pane");
		result.add(node.paneId);
	}
	return result;
}
function resourceStructureKey(state: WorkspaceState<WorkspacePane>): string {
	return JSON.stringify(
		state.tabs.map((tab) => [
			tab.id,
			tab.createdAt,
			Object.values(tab.panes)
				.sort((a, b) => a.id.localeCompare(b.id))
				.map((pane) => [
					pane.id,
					pane.kind,
					pane.data.resourceId,
					pane.data.executionId,
				]),
		]),
	);
}
function mergeField<T>(current: T, before: T, next: T): T {
	const key = (value: T) => JSON.stringify(value);
	if (key(next) === key(before)) return current;
	if (key(current) === key(before) || key(current) === key(next)) return next;
	throw new Error("Terminal tab field changed in another edit");
}
function mergePaneState(
	current: WorkspaceState<WorkspacePane>,
	before: WorkspaceState<WorkspacePane>,
	next: WorkspaceState<WorkspacePane>,
): WorkspaceState<WorkspacePane> {
	if (resourceStructureKey(current) !== resourceStructureKey(before)) {
		if (paneStateMetadataKey(current) === paneStateMetadataKey(next))
			return current;
		throw new Error("Terminal tab resources changed");
	}
	return {
		...next,
		activeTabId: mergeField(
			current.activeTabId,
			before.activeTabId,
			next.activeTabId,
		),
		tabs: next.tabs.map((tab) => {
			const previous = before.tabs.find((t) => t.id === tab.id),
				saved = current.tabs.find((t) => t.id === tab.id);
			if (!previous || !saved) return tab;
			return {
				...tab,
				titleOverride: mergeField(
					saved.titleOverride,
					previous.titleOverride,
					tab.titleOverride,
				),
				activePaneId: mergeField(
					saved.activePaneId,
					previous.activePaneId,
					tab.activePaneId,
				),
				layout: mergeField(saved.layout, previous.layout, tab.layout),
				panes: Object.fromEntries(
					Object.entries(tab.panes).map(([id, pane]) => {
						const oldPane = previous.panes[id],
							savedPane = saved.panes[id];
						return [
							id,
							oldPane && savedPane
								? {
										...pane,
										titleOverride: mergeField(
											savedPane.titleOverride,
											oldPane.titleOverride,
											pane.titleOverride,
										),
									}
								: pane,
						];
					}),
				),
			};
		}),
	};
}
export function applyWorkspacePaneState(
	workspace: WorkspaceView,
	next: WorkspaceState<WorkspacePane>,
	before: WorkspaceState<WorkspacePane>,
): boolean {
	if (next.tabs.length > 64) return false;
	const known = new Map(workspace.panes.map((p) => [p.paneId, p])),
		labels = new Map<string, string | undefined>(),
		seen = new Set<string>(),
		tabIds = new Set<string>();
	try {
		const current = toPaneState(workspace);
		next = mergePaneState(current, before, next);
		before = current;
		const paneTabs = next.tabs.map((tab) => {
			if (tabIds.has(tab.id)) throw new Error("Duplicate terminal tab");
			tabIds.add(tab.id);
			const members = layoutMembers(tab.layout);
			if (
				members.size !== Object.keys(tab.panes).length ||
				tab.activePaneId === null ||
				!members.has(tab.activePaneId)
			)
				throw new Error("Invalid terminal tab members");
			for (const [id, pane] of Object.entries(tab.panes)) {
				const original = known.get(id);
				if (
					!members.has(id) ||
					seen.has(id) ||
					!original ||
					pane.id !== id ||
					pane.data.paneId !== id ||
					pane.kind !== original.kind ||
					pane.data.kind !== original.kind ||
					pane.data.resourceId !== original.resourceId ||
					pane.data.executionId !== original.executionId
				)
					throw new Error("Terminal tab resource changed");
				seen.add(id);
				labels.set(id, pane.titleOverride?.slice(0, 128));
			}
			return {
				tabId: tab.id,
				label: tab.titleOverride?.slice(0, 128),
				createdAt: tab.createdAt,
				activePaneId: tab.activePaneId,
				layout: fromPaneLayout(tab.layout),
			};
		});
		const active = paneTabs.find((tab) => tab.tabId === next.activeTabId);
		if (paneTabs.length === 0 ? next.activeTabId !== null : !active)
			return false;
		const panes = workspace.panes
			.filter((p) => seen.has(p.paneId))
			.map((p) => ({ ...p, label: labels.get(p.paneId) }));
		const focused = panes.find((p) => p.paneId === active?.activePaneId);
		workspace.paneTabs = paneTabs;
		workspace.activePaneTabId = next.activeTabId;
		workspace.activePaneId = active?.activePaneId ?? null;
		workspace.panes = panes;
		workspace.layout = buildPaneTree(panes.map((p) => p.paneId));
		if (
			focused &&
			(before.activeTabId !== next.activeTabId ||
				before.tabs.find((t) => t.id === before.activeTabId)?.activePaneId !==
					active?.activePaneId)
		)
			workspace.activeTool = focused.kind;
		return true;
	} catch {
		return false;
	}
}

import type { LayoutNode, WorkspaceState } from "@superset/panes";
import type { PaneTree } from "../../../../../shared/workspace-view";
import type {
	WorkspacePaneV2 as WorkspacePane,
	WorkspaceViewV2 as WorkspaceView,
} from "../../../../../shared/workspace-view-v2";

export function toPaneLayout(tree: PaneTree): LayoutNode {
	return tree.type === "pane"
		? { ...tree }
		: {
				type: "split",
				direction: tree.axis,
				splitPercentage: tree.ratio * 100,
				first: toPaneLayout(tree.first),
				second: toPaneLayout(tree.second),
			};
}
export function fromPaneLayout(tree: LayoutNode): PaneTree {
	return tree.type === "pane"
		? { ...tree }
		: {
				type: "split",
				axis: tree.direction,
				ratio:
					Math.round(
						Math.max(0.1, Math.min(0.9, (tree.splitPercentage ?? 50) / 100)) *
							1e6,
					) / 1e6,
				first: fromPaneLayout(tree.first),
				second: fromPaneLayout(tree.second),
			};
}
function layoutPaneIds(tree: PaneTree, ids = new Set<string>()): Set<string> {
	if (tree.type === "pane") ids.add(tree.paneId);
	else {
		layoutPaneIds(tree.first, ids);
		layoutPaneIds(tree.second, ids);
	}
	return ids;
}
export function toPaneState(
	workspace: WorkspaceView,
): WorkspaceState<WorkspacePane> {
	const groups =
		workspace.paneTabs ??
		(workspace.layout
			? [
					{
						tabId: workspace.tabId,
						label: workspace.label,
						createdAt: 0,
						activePaneId: workspace.activePaneId,
						layout: workspace.layout,
					},
				]
			: []);
	return {
		version: 1,
		activeTabId: workspace.paneTabs
			? (workspace.activePaneTabId ?? null)
			: workspace.layout
				? workspace.tabId
				: null,
		tabs: groups.map((group) => {
			const members = layoutPaneIds(group.layout);
			return {
				id: group.tabId,
				titleOverride: group.label,
				createdAt: group.createdAt,
				activePaneId: group.activePaneId,
				layout: toPaneLayout(group.layout),
				panes: Object.fromEntries(
					workspace.panes
						.filter((p) => members.has(p.paneId))
						.map((p) => [
							p.paneId,
							{
								id: p.paneId,
								kind: p.kind,
								titleOverride: p.label,
								data: { ...p },
							},
						]),
				),
			};
		}),
	};
}

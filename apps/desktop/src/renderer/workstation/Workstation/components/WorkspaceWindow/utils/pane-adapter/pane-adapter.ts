import type { LayoutNode, WorkspaceState } from "@superset/panes";
import type {
	PaneTree,
	WorkspacePane,
	WorkspaceView,
} from "../../../../../../../shared/workspace-view";

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
export function toPaneState(
	workspace: WorkspaceView,
): WorkspaceState<WorkspacePane> {
	return {
		version: 1,
		activeTabId: workspace.layout ? workspace.tabId : null,
		tabs: workspace.layout
			? [
					{
						id: workspace.tabId,
						titleOverride: workspace.label,
						createdAt: 0,
						activePaneId: workspace.activePaneId,
						layout: toPaneLayout(workspace.layout),
						panes: Object.fromEntries(
							workspace.panes.map((p) => [
								p.paneId,
								{
									id: p.paneId,
									kind: p.kind,
									titleOverride: p.label,
									data: { ...p },
								},
							]),
						),
					},
				]
			: [],
	};
}

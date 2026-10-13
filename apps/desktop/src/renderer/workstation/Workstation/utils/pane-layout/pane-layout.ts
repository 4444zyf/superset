import type { PaneTree } from "../../../../../shared/workspace-view";

export function buildPaneTree(
	ids: string[],
	axis: "horizontal" | "vertical" = "horizontal",
): PaneTree | null {
	if (!ids.length) return null;
	if (ids.length === 1) return { type: "pane", paneId: ids[0]! };
	const middle = Math.floor(ids.length / 2);
	const next = axis === "horizontal" ? "vertical" : "horizontal";
	return {
		type: "split",
		axis,
		ratio: 0.5,
		first: buildPaneTree(ids.slice(0, middle), next)!,
		second: buildPaneTree(ids.slice(middle), next)!,
	};
}
export function splitPane(
	tree: PaneTree | null,
	paneId: string | null,
	added: string,
	axis: "horizontal" | "vertical",
): PaneTree {
	if (!tree) return { type: "pane", paneId: added };
	if (tree.type === "pane")
		return tree.paneId === paneId
			? {
					type: "split",
					axis,
					ratio: 0.5,
					first: tree,
					second: { type: "pane", paneId: added },
				}
			: tree;
	return {
		...tree,
		first: splitPane(tree.first, paneId, added, axis),
		second: splitPane(tree.second, paneId, added, axis),
	};
}
export function removePane(
	tree: PaneTree | null,
	paneId: string,
): PaneTree | null {
	if (!tree) return null;
	if (tree.type === "pane") return tree.paneId === paneId ? null : tree;
	const first = removePane(tree.first, paneId);
	const second = removePane(tree.second, paneId);
	return first && second ? { ...tree, first, second } : (first ?? second);
}
export function updateRatio(
	tree: PaneTree | null,
	path: ("first" | "second")[],
	ratio: number,
): PaneTree | null {
	if (!Number.isFinite(ratio)) throw new Error("Invalid split ratio");
	if (!tree || tree.type === "pane") return tree;
	if (!path.length)
		return { ...tree, ratio: Math.max(0.1, Math.min(0.9, ratio)) };
	const child = path[0]!;
	return { ...tree, [child]: updateRatio(tree[child], path.slice(1), ratio)! };
}

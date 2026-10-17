import { PANE_MIN_DIMENSIONS } from "@superset/panes";
import type { PaneTree } from "../../../../../../../../../shared/workspace-view";

function fits(layout: PaneTree, width: number, height: number): boolean {
	if (layout.type === "pane")
		return (
			width >= PANE_MIN_DIMENSIONS.width && height >= PANE_MIN_DIMENSIONS.height
		);
	if (layout.axis === "horizontal") {
		const available = width - 1;
		return (
			fits(layout.first, available * layout.ratio, height) &&
			fits(layout.second, available * (1 - layout.ratio), height)
		);
	}
	const available = height - 1;
	return (
		fits(layout.first, width, available * layout.ratio) &&
		fits(layout.second, width, available * (1 - layout.ratio))
	);
}

export function isCompactPaneLayout({
	viewportWidth,
	paneCount,
	layout,
	availableSize,
}: {
	viewportWidth: number;
	paneCount: number;
	layout: PaneTree | null;
	availableSize: { width: number; height: number } | null;
}): boolean {
	return (
		viewportWidth < 1000 ||
		paneCount > 8 ||
		Boolean(
			layout &&
				availableSize &&
				!fits(layout, availableSize.width, availableSize.height),
		)
	);
}

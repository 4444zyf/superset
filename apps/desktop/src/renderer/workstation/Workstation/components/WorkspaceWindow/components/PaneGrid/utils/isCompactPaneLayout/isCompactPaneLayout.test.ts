import { expect, test } from "bun:test";
import type { PaneTree } from "../../../../../../../../../shared/workspace-view";
import { isCompactPaneLayout } from "./isCompactPaneLayout";

const pane = (paneId: string): PaneTree => ({ type: "pane", paneId });
const split = (
	axis: "horizontal" | "vertical",
	ratio: number,
	first: PaneTree,
	second: PaneTree,
): PaneTree => ({ type: "split", axis, ratio, first, second });
const three = split(
	"horizontal",
	0.37,
	split("vertical", 0.5, pane("claude"), pane("omp")),
	pane("codex"),
);
const four = split(
	"horizontal",
	0.37,
	split(
		"vertical",
		0.5,
		pane("claude"),
		split("horizontal", 0.5, pane("omp"), pane("chat")),
	),
	pane("codex"),
);
const compact = (layout: PaneTree, width: number, height: number) =>
	isCompactPaneLayout({
		viewportWidth: 1200,
		paneCount: layout === three ? 3 : 4,
		layout,
		availableSize: { width, height },
	});

test("the existing three-pane layout stays expanded when its actual content area fits", () => {
	expect(compact(three, 944, 662)).toBe(false);
});

test("adding chat uses the compact switcher when a nested split cannot fit the original minimum widths", () => {
	expect(compact(four, 944, 662)).toBe(true);
});

test("a wider content area can display the same persisted four-pane layout", () => {
	expect(compact(four, 1440, 662)).toBe(false);
});

test("vertical splits also respect the original minimum height", () => {
	expect(compact(three, 944, 300)).toBe(true);
});

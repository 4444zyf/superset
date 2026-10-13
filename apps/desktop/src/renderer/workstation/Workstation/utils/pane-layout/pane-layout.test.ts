import { expect, test } from "bun:test";
import {
	buildPaneTree,
	removePane,
	splitPane,
	updateRatio,
} from "./pane-layout";

test("splitting and closing a pane preserve unrelated axis, order and ratio", () => {
	const original = {
		type: "split" as const,
		axis: "horizontal" as const,
		ratio: 0.37,
		first: { type: "pane" as const, paneId: "claude" },
		second: { type: "pane" as const, paneId: "codex" },
	};
	const split = splitPane(original, "codex", "omp", "vertical");
	expect(split).toMatchObject({
		ratio: 0.37,
		second: {
			type: "split",
			axis: "vertical",
			first: { paneId: "codex" },
			second: { paneId: "omp" },
		},
	});
	expect(removePane(split, "omp")).toEqual(original);
	expect(original.second.type).toBe("pane");
});

test("separator updates clamp finite values and change only the addressed split", () => {
	const tree = splitPane(
		buildPaneTree(["claude", "codex"]),
		"codex",
		"omp",
		"vertical",
	);
	expect(updateRatio(tree, ["second"], 0.64)).toMatchObject({
		ratio: 0.5,
		second: { ratio: 0.64 },
	});
	expect(updateRatio(tree, [], 2)).toMatchObject({ ratio: 0.9 });
	expect(() => updateRatio(tree, [], Number.NaN)).toThrow();
});

test("empty layouts and balanced trees preserve the exact pane order", () => {
	expect(buildPaneTree([])).toBeNull();
	expect(buildPaneTree(["claude", "codex", "omp"])).toMatchObject({
		first: { paneId: "claude" },
		second: {
			axis: "vertical",
			first: { paneId: "codex" },
			second: { paneId: "omp" },
		},
	});
});

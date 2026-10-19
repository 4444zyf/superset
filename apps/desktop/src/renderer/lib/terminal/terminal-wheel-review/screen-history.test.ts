import { describe, expect, it } from "bun:test";
import { ScreenHistory } from "./screen-history";

describe("alternate screen history", () => {
	it("keeps earlier TUI screens while skipping repeated renders and joining actual scrolling", () => {
		const history = new ScreenHistory();
		history.capture(["one", "two", "three"]);
		history.capture(["one", "two", "three"]);
		history.capture(["two", "three", "four"]);
		expect(history.lines()).toEqual(["one", "two", "three", "four"]);
		history.capture(["new screen", "input"]);
		expect(history.lines()).toEqual([
			"one",
			"two",
			"three",
			"four",
			"",
			"new screen",
			"input",
		]);
	});
	it("bounds retained text even for repeated full-screen redraws and huge lines", () => {
		const history = new ScreenHistory({ maxLines: 5, maxChars: 20 });
		history.capture(["old", "screen"]);
		history.capture(["next", "screen"]);
		history.capture(["x".repeat(40)]);
		expect(history.lines().join("\n").length).toBeLessThanOrEqual(20);
		expect(history.lines().length).toBeLessThanOrEqual(5);
		expect(history.lines().join("\n")).not.toContain("old");
		history.clear();
		expect(history.lines()).toEqual([]);
	});
});

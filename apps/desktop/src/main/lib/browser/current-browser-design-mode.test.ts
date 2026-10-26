import { expect, test } from "bun:test";
import type {
	DesignModeScreenshot,
	DesignModeSelectionResult,
} from "shared/browser-design-mode";
import { currentBrowserDesignMode } from "./current-browser-design-mode";

function fixture() {
	let current = true;
	const armed = Promise.withResolvers<boolean>();
	const selection = Promise.withResolvers<DesignModeSelectionResult>();
	const screenshot = Promise.withResolvers<DesignModeScreenshot | null>();
	const calls: unknown[] = [];
	const source = currentBrowserDesignMode(
		{
			setDesignMode: async (...input) => {
				calls.push(["set", ...input]);
				return armed.promise;
			},
			awaitDesignSelection: async (...input) => {
				calls.push(["select", ...input]);
				return selection.promise;
			},
			captureDesignScreenshot: async (...input) => {
				calls.push(["screenshot", ...input]);
				return screenshot.promise;
			},
		},
		"owned-manager-key",
		() => current,
	);
	return {
		source,
		armed,
		selection,
		screenshot,
		calls,
		retire: () => {
			current = false;
		},
	};
}
const rect = { x: 10, y: 20, width: 100, height: 32 };

test("design operations delegate exclusively to the resolved manager pane", async () => {
	const f = fixture();
	f.armed.resolve(true);
	f.selection.resolve({ kind: "cancelled", opId: "owned-op", reason: "user" });
	f.screenshot.resolve(null);
	expect(await f.source.set(true)).toEqual({ ok: true });
	expect(await f.source.awaitSelection("owned-op")).toEqual({
		kind: "cancelled",
		opId: "owned-op",
		reason: "user",
	});
	expect(await f.source.screenshot(rect)).toEqual({ screenshot: null });
	expect(f.calls).toEqual([
		["set", "owned-manager-key", true],
		["select", "owned-manager-key", "owned-op"],
		["screenshot", "owned-manager-key", rect],
	]);
});

test("retired panes cannot arm, select or capture another pane", async () => {
	const f = fixture();
	f.retire();
	await expect(f.source.set(true)).rejects.toThrow(
		"Browser pane is no longer current",
	);
	await expect(f.source.awaitSelection("op")).rejects.toThrow(
		"Browser pane is no longer current",
	);
	await expect(f.source.screenshot(rect)).rejects.toThrow(
		"Browser pane is no longer current",
	);
	expect(f.calls).toEqual([]);
});

test("retirement during arming rejects a late success", async () => {
	const f = fixture();
	const result = f.source.set(true);
	f.retire();
	f.armed.resolve(true);
	await expect(result).rejects.toThrow("Browser pane is no longer current");
});

test("retirement during selection withholds the old document result", async () => {
	const f = fixture();
	const result = f.source.awaitSelection("owned-op");
	f.retire();
	f.selection.resolve({
		kind: "error",
		opId: "owned-op",
		reason: "old page details",
	});
	await expect(result).rejects.toThrow("Browser pane is no longer current");
});

test("retirement during capture withholds the old screenshot", async () => {
	const f = fixture();
	const result = f.source.screenshot(rect);
	f.retire();
	f.screenshot.resolve({
		mimeType: "image/png",
		dataUrl: "data:image/png;base64,AA==",
		width: 100,
		height: 32,
	});
	await expect(result).rejects.toThrow("Browser pane is no longer current");
});

test("a live manager failure remains a failure", async () => {
	const f = fixture();
	const error = new Error("owned capture failed");
	const result = f.source.screenshot(rect);
	f.screenshot.reject(error);
	await expect(result).rejects.toBe(error);
});

test("disable keeps the original manager result rather than inventing success", async () => {
	const f = fixture();
	f.armed.resolve(false);
	expect(await f.source.set(false)).toEqual({ ok: false });
	expect(f.calls).toEqual([["set", "owned-manager-key", false]]);
});

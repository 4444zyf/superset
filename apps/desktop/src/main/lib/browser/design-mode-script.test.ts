import { describe, expect, test } from "bun:test";
import { runInNewContext } from "node:vm";
import { buildDesignModeScript } from "./design-mode-script";

describe("buildDesignModeScript", () => {
	test("arm script emits every payload field the clamp expects", () => {
		const arm = buildDesignModeScript("arm");
		// Fields silently dropped here reach the renderer as null forever —
		// reactProps shipped dead once because extractPayload never emitted it.
		for (const field of [
			"reactComponents: react.reactComponents",
			"reactProps: react.reactProps",
			"sourceFile: react.sourceFile",
			"htmlSnippet:",
			"computedStyles:",
			"rectViewport:",
		]) {
			expect(arm).toContain(field);
		}
	});

	test("awaitClick resolves the cancellation marker main classifies", () => {
		expect(buildDesignModeScript("awaitClick")).toContain(
			"__supersetDesignCancelled: true",
		);
	});

	test("selection hits the clicked element before hover paint and after layout changes", async () => {
		for (const paintHover of [false, true]) {
			const page = document.implementation.createHTMLDocument("Owned page");
			page.body.innerHTML =
				'<h1 id="heading">Owned title</h1><a id="link">Other element</a>';
			const heading = page.querySelector("h1")!;
			const link = page.querySelector("a")!;
			page.elementFromPoint = (_x, y) => (y < 50 ? heading : link);
			const frames = new Map<number, FrameRequestCallback>();
			let nextFrame = 0;
			const events = new EventTarget();
			const guest = {
				location: new URL("http://localhost/owned"),
				innerWidth: 800,
				innerHeight: 600,
				scrollX: 0,
				scrollY: 0,
				devicePixelRatio: 1,
				getComputedStyle: window.getComputedStyle.bind(window),
				CSS: window.CSS,
				addEventListener: events.addEventListener.bind(events),
				removeEventListener: events.removeEventListener.bind(events),
			};
			const context = {
				window: guest,
				document: page,
				URL,
				Node,
				NodeFilter,
				requestAnimationFrame: (callback: FrameRequestCallback) => {
					frames.set(++nextFrame, callback);
					return nextFrame;
				},
				cancelAnimationFrame: (id: number) => frames.delete(id),
			};
			runInNewContext(buildDesignModeScript("arm"), context);
			const selection = runInNewContext(
				buildDesignModeScript("awaitClick"),
				context,
			);
			const host = page.querySelector("#__superset-design-mode-host")!;
			host.dispatchEvent(
				new MouseEvent("mousemove", { clientX: 100, clientY: 70 }),
			);
			if (paintHover) {
				const callbacks = [...frames.values()];
				frames.clear();
				for (const callback of callbacks) callback(0);
			}
			host.dispatchEvent(
				new MouseEvent("click", { clientX: 100, clientY: 39 }),
			);
			const result = await selection;
			expect(result.target?.tagName).toBe("h1");
			expect(result.target?.selector).toBe("h1#heading");
			expect(frames.size).toBe(0);
			runInNewContext(buildDesignModeScript("teardown"), context);
			expect(page.querySelector("#__superset-design-mode-host")).toBeNull();
		}
	});
});

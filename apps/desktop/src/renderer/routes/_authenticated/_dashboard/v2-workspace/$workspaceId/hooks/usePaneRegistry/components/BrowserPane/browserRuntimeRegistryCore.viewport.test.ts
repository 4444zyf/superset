import { expect, test } from "bun:test";
import { BrowserRuntimeRegistryCore } from "./browserRuntimeRegistryCore";

function fixture() {
	const registry = new BrowserRuntimeRegistryCore({
		browser: {
			register: { mutate: async () => {} },
			unregister: { mutate: async () => {} },
			onAgentActivePanes: { subscribe: () => ({ unsubscribe() {} }) },
		},
		browserHistory: { upsert: { mutate: async () => {} } },
	});
	const area = document.createElement("div"),
		frame = document.createElement("div");
	let scroll = 0;
	area.style.overflowX = "auto";
	area.style.overflowY = "auto";
	area.appendChild(frame);
	document.body.appendChild(area);
	Object.defineProperties(area, {
		getBoundingClientRect: {
			value: () => DOMRect.fromRect({ x: 90, y: 90, width: 220, height: 200 }),
		},
		clientWidth: { value: 220 },
		clientHeight: { value: 200 },
		clientLeft: { value: 0 },
		clientTop: { value: 0 },
	});
	frame.getBoundingClientRect = () =>
		DOMRect.fromRect({ x: 100, y: 100 - scroll, width: 200, height: 400 });
	registry.attach(
		"viewport",
		frame,
		"about:blank",
		"workspace",
		() => {},
		() => {},
	);
	const entry = registry.openBackground(
			"viewport",
			"about:blank",
			"workspace",
			() => {},
		),
		root = entry.webview.parentElement;
	return {
		entry,
		scroll() {
			scroll = 150;
			area.dispatchEvent(new Event("scroll"));
		},
		cleanup() {
			registry.destroy("viewport");
			root?.remove();
			area.remove();
		},
	};
}

test("the hoisted page is clipped while host popovers retain their overlay area", () => {
	const f = fixture();
	try {
		expect(f.entry.webview.style.clipPath).toBe("inset(0px 0px 210px 0px)");
		expect(f.entry.overlay.style.clipPath).toBe("");
		expect(
			f.entry.overlay.style.getPropertyValue("--browser-visible-bottom"),
		).toBe("210px");
	} finally {
		f.cleanup();
	}
});

test("scrolling a preview ancestor moves the hoisted page and overlay with its frame", () => {
	const f = fixture();
	try {
		expect(f.entry.webview.style.top).toBe("100px");
		f.scroll();
		expect(f.entry.webview.style.top).toBe("-50px");
		expect(f.entry.overlay.style.top).toBe("-50px");
		expect(f.entry.webview.style.clipPath).toBe("inset(140px 0px 60px 0px)");
	} finally {
		f.cleanup();
	}
});

test("a guest viewport report cannot clear the host overflow clip", async () => {
	const f = fixture();
	let calls = 0;
	Object.assign(f.entry.webview, {
		getWebContentsId: () => 42,
		executeJavaScript: async () => {
			if (++calls > 1) throw Error("Owned viewport stream ended");
			return { scale: 1, x: 0, y: 0, width: 200, height: 400 };
		},
	});
	try {
		f.entry.webview.dispatchEvent(new Event("dom-ready"));
		await Promise.resolve();
		await Promise.resolve();
		expect(f.entry.webview.style.clipPath).toBe("inset(0px 0px 210px 0px)");
	} finally {
		f.cleanup();
	}
});

test("pinch coordinates use the host surface dimensions when Chromium page zoom changes guest CSS pixels", async () => {
	const f = fixture();
	let calls = 0;
	Object.assign(f.entry.webview, {
		getWebContentsId: () => 43,
		executeJavaScript: async () => {
			if (++calls > 1) throw Error("Owned viewport stream ended");
			return { scale: 2, x: 20, y: 30, width: 100, height: 200 };
		},
	});
	try {
		f.entry.webview.dispatchEvent(new Event("dom-ready"));
		await Promise.resolve();
		await Promise.resolve();
		expect(f.entry.webview.style.transform).toBe(
			"translate(-40px, -60px) scale(2)",
		);
		expect(f.entry.webview.style.clipPath).toBe("inset(30px 80px 275px 20px)");
	} finally {
		f.cleanup();
	}
});

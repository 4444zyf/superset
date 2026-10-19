import { afterEach, describe, expect, it, mock } from "bun:test";
import type { Terminal } from "@xterm/xterm";
import { installTerminalWheelReview } from "./terminal-wheel-review";

const cleanups: (() => void)[] = [];
afterEach(() => {
	for (const dispose of cleanups.splice(0)) dispose();
	document.body.replaceChildren();
});
function fixture() {
	let handler: (event: WheelEvent) => boolean = () => true;
	let changed: (buffer: { type: string }) => void = () => {};
	const focus = mock(() => {}),
		input = mock(() => {}),
		scrollLines = mock(() => {});
	const element = document.createElement("div");
	document.body.append(element);
	const lines = Array.from(
		{ length: 20 },
		(_, i) => `terminal line ${i} 中文 🙂`,
	);
	const active = {
		type: "alternate",
		length: 20,
		getLine: (i: number) => ({ translateToString: () => lines[i] }),
	};
	const terminal = {
		rows: 20,
		cols: 80,
		element,
		options: { fontSize: 14 },
		modes: { mouseTrackingMode: "none" },
		buffer: {
			active,
			normal: active,
			onBufferChange: (fn: typeof changed) => {
				changed = fn;
				return { dispose: mock(() => {}) };
			},
		},
		parser: {
			registerCsiHandler: () => ({ dispose: mock(() => {}) }),
			registerEscHandler: () => ({ dispose: mock(() => {}) }),
		},
		_core: {
			_renderService: {
				dimensions: { css: { cell: { height: 17, width: 8 } } },
			},
		},
		onWriteParsed: () => ({ dispose: mock(() => {}) }),
		onResize: () => ({ dispose: mock(() => {}) }),
		loadAddon: () => {},
		focus,
		input,
		scrollLines,
		attachCustomWheelEventHandler: (fn: typeof handler) => {
			handler = fn;
		},
	} as unknown as Terminal;
	const dispose = installTerminalWheelReview(terminal);
	cleanups.push(dispose);
	const wheel = (deltaY: number) =>
		handler(new WheelEvent("wheel", { deltaY, cancelable: true }));
	return {
		element,
		terminal,
		wheel,
		input,
		focus,
		dispose,
		changed: () => changed({ type: "normal" }),
	};
}
describe("terminal wheel review", () => {
	it("opens selectable client history, blocks paste and closes on Escape without remote input", () => {
		const f = fixture();
		f.wheel(-51);
		const review = f.element.querySelector<HTMLElement>(
			"[data-terminal-scrollback-review]",
		);
		if (!review) throw new Error("Expected terminal history review");
		expect(review.querySelector("pre")?.textContent).toContain("中文 🙂");
		expect(document.activeElement).toBe(review);
		const paste = new Event("paste", { cancelable: true, bubbles: true });
		review.dispatchEvent(paste);
		expect(paste.defaultPrevented).toBe(true);
		const escapeEvent = new KeyboardEvent("keydown", {
			key: "Escape",
			cancelable: true,
			bubbles: true,
		});
		review.dispatchEvent(escapeEvent);
		expect(escapeEvent.defaultPrevented).toBe(true);
		expect(review.isConnected).toBe(false);
		expect(f.input).not.toHaveBeenCalled();
		expect(f.focus).toHaveBeenCalledTimes(1);
	});
	it("returns to live terminal at the bottom and releases history on buffer exit/disposal", () => {
		const f = fixture();
		f.wheel(17);
		expect(
			f.element.querySelector("[data-terminal-scrollback-review]"),
		).toBeNull();
		f.wheel(-34);
		const pre = f.element.querySelector("pre");
		if (!pre) throw new Error("Expected scrollable terminal history");
		Object.defineProperties(pre, {
			scrollHeight: { value: 1000 },
			clientHeight: { value: 200 },
		});
		pre.scrollTop = 790;
		pre.dispatchEvent(
			new WheelEvent("wheel", { deltaY: 30, bubbles: true, cancelable: true }),
		);
		expect(f.element.querySelector("pre")).toBeNull();
		f.wheel(-34);
		f.changed();
		expect(f.element.querySelector("pre")).toBeNull();
		f.wheel(-34);
		f.dispose();
		f.wheel(-34);
		expect(f.element.querySelector("pre")).toBeNull();
		expect(f.input).not.toHaveBeenCalled();
	});
});

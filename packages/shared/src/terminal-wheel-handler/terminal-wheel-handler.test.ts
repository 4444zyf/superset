import { beforeEach, describe, expect, it, mock } from "bun:test";
import type { Terminal as XTerm } from "@xterm/xterm";
import {
	buildArrowSequence,
	buildSgrWheelReport,
	consumeWheelLines,
	createTerminalWheelEventHandler,
	createWheelLineState,
	type WheelLineContext,
} from "./terminal-wheel-handler";

const DOM_DELTA_PIXEL = 0;
const DOM_DELTA_LINE = 1;
const DOM_DELTA_PAGE = 2;

function makeContext(
	overrides: Partial<WheelLineContext> = {},
): WheelLineContext {
	return {
		cellHeight: 17,
		rows: 40,
		scrollSensitivity: 1,
		fastScrollSensitivity: 5,
		contextKey: "alternate:any:false",
		...overrides,
	};
}

function pixelEvent(deltaY: number) {
	return { deltaY, deltaMode: DOM_DELTA_PIXEL, altKey: false, ctrlKey: false };
}

describe("consumeWheelLines", () => {
	it("maps one cell height of pixels to one line without damping", () => {
		const state = createWheelLineState();
		expect(consumeWheelLines(state, pixelEvent(17), makeContext())).toBe(1);
	});

	it("accumulates fractional deltas across events instead of dropping them", () => {
		// Three trackpad ticks of 6px against a 17px cell: stock xterm (with its
		// 0.3x damping) would need ~10 ticks per line; we need three.
		const state = createWheelLineState();
		const context = makeContext();
		expect(consumeWheelLines(state, pixelEvent(6), context)).toBe(0);
		expect(consumeWheelLines(state, pixelEvent(6), context)).toBe(0);
		expect(consumeWheelLines(state, pixelEvent(6), context)).toBe(1);
	});

	it("preserves the remainder after emitting whole lines", () => {
		const state = createWheelLineState();
		const context = makeContext();
		expect(consumeWheelLines(state, pixelEvent(25), context)).toBe(1);
		// 25/17 = 1.47 → remainder 0.47; another 9px (0.53) crosses the line.
		expect(consumeWheelLines(state, pixelEvent(9), context)).toBe(1);
	});

	it("emits multiple lines for a single large event (flick momentum)", () => {
		const state = createWheelLineState();
		expect(consumeWheelLines(state, pixelEvent(170), makeContext())).toBe(10);
	});

	it("handles scrolling up with negative deltas", () => {
		const state = createWheelLineState();
		const context = makeContext();
		expect(consumeWheelLines(state, pixelEvent(-34), context)).toBe(-2);
	});

	it("lets opposite-direction residue cancel naturally", () => {
		const state = createWheelLineState();
		const context = makeContext();
		consumeWheelLines(state, pixelEvent(9), context); // +0.53 pending
		expect(consumeWheelLines(state, pixelEvent(-9), context)).toBe(0);
		expect(state.partialLines).toBeCloseTo(0);
	});

	it("resets the accumulator when the context changes", () => {
		const state = createWheelLineState();
		consumeWheelLines(state, pixelEvent(16), makeContext()); // 0.94 pending
		const lines = consumeWheelLines(
			state,
			pixelEvent(2),
			makeContext({ contextKey: "alternate:none:false" }),
		);
		// Without the reset the stale 0.94 would fire a phantom line.
		expect(lines).toBe(0);
	});

	it("treats DOM_DELTA_LINE deltas as lines directly", () => {
		const state = createWheelLineState();
		expect(
			consumeWheelLines(
				state,
				{ deltaY: 3, deltaMode: DOM_DELTA_LINE, altKey: false, ctrlKey: false },
				makeContext(),
			),
		).toBe(3);
	});

	it("treats DOM_DELTA_PAGE deltas as pages of rows", () => {
		const state = createWheelLineState();
		expect(
			consumeWheelLines(
				state,
				{ deltaY: 1, deltaMode: DOM_DELTA_PAGE, altKey: false, ctrlKey: false },
				makeContext({ rows: 24 }),
			),
		).toBe(24);
	});

	it("applies fast-scroll sensitivity when alt or ctrl is held", () => {
		const state = createWheelLineState();
		expect(
			consumeWheelLines(
				state,
				{
					deltaY: 17,
					deltaMode: DOM_DELTA_PIXEL,
					altKey: true,
					ctrlKey: false,
				},
				makeContext(),
			),
		).toBe(5);
	});

	it("caps a single event at one page of lines", () => {
		const state = createWheelLineState();
		expect(
			consumeWheelLines(state, pixelEvent(100_000), makeContext({ rows: 40 })),
		).toBe(40);
		expect(state.partialLines).toBe(0);
	});
});

describe("sequence builders", () => {
	it("builds SGR wheel reports with direction and modifiers", () => {
		const noMods = { altKey: false, ctrlKey: false };
		expect(buildSgrWheelReport(-10, 5, 7, noMods)).toBe("\x1b[<64;5;7M");
		expect(buildSgrWheelReport(10, 5, 7, noMods)).toBe("\x1b[<65;5;7M");
		expect(buildSgrWheelReport(10, 1, 1, { altKey: true, ctrlKey: true })).toBe(
			"\x1b[<89;1;1M",
		);
	});

	it("builds cursor sequences honoring application cursor keys mode", () => {
		expect(buildArrowSequence(-1, false)).toBe("\x1b[A");
		expect(buildArrowSequence(1, false)).toBe("\x1b[B");
		expect(buildArrowSequence(-1, true)).toBe("\x1bOA");
		expect(buildArrowSequence(1, true)).toBe("\x1bOB");
	});
});

interface FakeTerminalOptions {
	bufferType?: "normal" | "alternate";
	mouseTrackingMode?: "none" | "x10" | "vt200" | "drag" | "any";
	applicationCursorKeysMode?: boolean;
	cellHeight?: number;
}

function makeFakeTerminal(options: FakeTerminalOptions = {}) {
	const input = mock((_data: string, _userInput?: boolean) => {});
	const scrollLines = mock((_lines: number) => {});
	const terminal = {
		input,
		scrollLines,
		cols: 80,
		rows: 40,
		options: { scrollSensitivity: 1, fastScrollSensitivity: 5 },
		buffer: { active: { type: options.bufferType ?? "alternate" } },
		modes: {
			mouseTrackingMode: options.mouseTrackingMode ?? "none",
			applicationCursorKeysMode: options.applicationCursorKeysMode ?? false,
		},
		element: null,
		_core: {
			_renderService: {
				dimensions: {
					css: { cell: { width: 8, height: options.cellHeight ?? 17 } },
				},
			},
		},
	};
	return { terminal: terminal as unknown as XTerm, input, scrollLines };
}

function wheelEvent(
	deltaY: number,
	overrides: Partial<WheelEvent> = {},
): WheelEvent & { defaultPrevented: boolean } {
	const event = {
		deltaY,
		deltaMode: DOM_DELTA_PIXEL,
		altKey: false,
		ctrlKey: false,
		shiftKey: false,
		clientX: 0,
		clientY: 0,
		defaultPrevented: false,
		preventDefault() {
			this.defaultPrevented = true;
		},
		stopPropagation() {},
		...overrides,
	};
	return event as unknown as WheelEvent & { defaultPrevented: boolean };
}

describe("createTerminalWheelEventHandler", () => {
	let sgrActive: boolean;
	const isSgrActive = () => sgrActive;

	beforeEach(() => {
		sgrActive = false;
	});

	it("scrolls the normal buffer without allowing stock cursor-key fallback at zero scrollback", () => {
		const { terminal, input, scrollLines } = makeFakeTerminal({
			bufferType: "normal",
		});
		const handler = createTerminalWheelEventHandler(terminal, isSgrActive);
		expect(handler(wheelEvent(40))).toBe(false);
		expect(scrollLines).toHaveBeenCalledWith(2);
		expect(input).not.toHaveBeenCalled();
	});

	it("sends SGR reports for normal-buffer mouse tracking (Claude Code)", () => {
		sgrActive = true;
		const { terminal, input } = makeFakeTerminal({
			bufferType: "normal",
			mouseTrackingMode: "any",
		});
		const handler = createTerminalWheelEventHandler(terminal, isSgrActive);
		expect(handler(wheelEvent(34))).toBe(false);
		expect(input).toHaveBeenCalledWith("\x1b[<65;1;1M\x1b[<65;1;1M", true);
	});

	it("defers to viewport scrollback for x10 tracking in the normal buffer", () => {
		const { terminal, input } = makeFakeTerminal({
			bufferType: "normal",
			mouseTrackingMode: "x10",
		});
		const handler = createTerminalWheelEventHandler(terminal, isSgrActive);
		expect(handler(wheelEvent(40))).toBe(false);
		expect(input).not.toHaveBeenCalled();
	});

	it("uses client review for shift-wheel instead of stock alternate-buffer arrows", () => {
		const { terminal } = makeFakeTerminal();
		const handler = createTerminalWheelEventHandler(terminal, isSgrActive);
		expect(handler(wheelEvent(40, { shiftKey: true }))).toBe(false);
	});

	it("reviews alternate-buffer content without generating direction keys", () => {
		const { terminal, input } = makeFakeTerminal();
		const review = mock((_lines: number) => {});
		const handler = createTerminalWheelEventHandler(
			terminal,
			isSgrActive,
			review,
		);
		const event = wheelEvent(-51);
		expect(handler(event)).toBe(false);
		expect(review).toHaveBeenCalledWith(-3);
		expect(input).not.toHaveBeenCalled();
		expect(event.defaultPrevented).toBe(true);
	});

	it("does not turn wheel gestures into application cursor keys", () => {
		const { terminal, input, scrollLines } = makeFakeTerminal({
			applicationCursorKeysMode: true,
		});
		const handler = createTerminalWheelEventHandler(terminal, isSgrActive);
		handler(wheelEvent(-17));
		expect(input).not.toHaveBeenCalled();
		expect(scrollLines).toHaveBeenCalledWith(-1);
	});

	it("accumulates small trackpad deltas for client review without input", () => {
		const { terminal, input } = makeFakeTerminal();
		const review = mock((_lines: number) => {});
		const handler = createTerminalWheelEventHandler(
			terminal,
			isSgrActive,
			review,
		);
		handler(wheelEvent(-6));
		handler(wheelEvent(-6));
		expect(review).not.toHaveBeenCalled();
		handler(wheelEvent(-6));
		expect(review).toHaveBeenCalledWith(-1);
		expect(input).not.toHaveBeenCalled();
	});

	it("sends SGR wheel reports when mouse tracking + SGR encoding are active", () => {
		sgrActive = true;
		const { terminal, input } = makeFakeTerminal({ mouseTrackingMode: "any" });
		const handler = createTerminalWheelEventHandler(terminal, isSgrActive);
		expect(handler(wheelEvent(34))).toBe(false);
		expect(input).toHaveBeenCalledWith("\x1b[<65;1;1M\x1b[<65;1;1M", true);
	});

	it("defers to stock xterm when mouse tracking is active without SGR encoding", () => {
		const { terminal, input } = makeFakeTerminal({
			mouseTrackingMode: "vt200",
		});
		const handler = createTerminalWheelEventHandler(terminal, isSgrActive);
		expect(handler(wheelEvent(40))).toBe(true);
		expect(input).not.toHaveBeenCalled();
	});

	it("reviews content for x10 tracking, which never reports wheel", () => {
		const { terminal, input, scrollLines } = makeFakeTerminal({
			mouseTrackingMode: "x10",
		});
		const handler = createTerminalWheelEventHandler(terminal, isSgrActive);
		expect(handler(wheelEvent(17))).toBe(false);
		expect(input).not.toHaveBeenCalled();
		expect(scrollLines).toHaveBeenCalledWith(1);
	});

	it("reviews legacy TUI history when an old host cannot accept binary reports", () => {
		const { terminal, input, scrollLines } = makeFakeTerminal({
			mouseTrackingMode: "vt200",
		});
		const handler = createTerminalWheelEventHandler(
			terminal,
			isSgrActive,
			scrollLines,
			() => false,
		);
		expect(handler(wheelEvent(-34))).toBe(false);
		expect(scrollLines).toHaveBeenCalledWith(-2);
		expect(input).not.toHaveBeenCalled();
	});

	it("never falls back to arrow input when cell dimensions are unavailable", () => {
		const { terminal, input } = makeFakeTerminal();
		(terminal as unknown as { _core: unknown })._core = undefined;
		const handler = createTerminalWheelEventHandler(terminal, isSgrActive);
		expect(handler(wheelEvent(40))).toBe(false);
		expect(input).not.toHaveBeenCalled();
	});

	it("keeps client history input-free with the stock-wheel escape hatch", () => {
		const globals = globalThis as { localStorage?: Pick<Storage, "getItem"> };
		const original = globals.localStorage;
		try {
			globals.localStorage = {
				getItem: (key) =>
					key === "SUPERSET_TERMINAL_STOCK_WHEEL" ? "1" : null,
			};
			const { terminal, input } = makeFakeTerminal();
			const handler = createTerminalWheelEventHandler(terminal, isSgrActive);
			expect(handler(wheelEvent(51))).toBe(false);
			expect(input).not.toHaveBeenCalled();

			globals.localStorage = { getItem: () => null };
			expect(handler(wheelEvent(51))).toBe(false);
			expect(input).not.toHaveBeenCalled();
		} finally {
			globals.localStorage = original;
		}
	});
});

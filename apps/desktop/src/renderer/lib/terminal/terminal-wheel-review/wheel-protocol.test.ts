import "../../../../main/terminal-host/xterm-env-polyfill";
import { expect, test } from "bun:test";
import {
	createSgrMouseModeTracker,
	createTerminalWheelEventHandler,
} from "@superset/shared/terminal-wheel-handler";
import { Terminal } from "@xterm/headless";
import type { Terminal as BrowserTerminal } from "@xterm/xterm";

test("real VT mode transitions preserve TUI mouse reports and never synthesize cursor keys", async () => {
	const terminal = new Terminal({ cols: 80, rows: 24, allowProposedApi: true });
	const browserTerminal = terminal as unknown as BrowserTerminal;
	Object.assign((terminal as unknown as { _core: object })._core, {
		_renderService: { dimensions: { css: { cell: { height: 17, width: 8 } } } },
	});
	const tracker = createSgrMouseModeTracker(browserTerminal);
	const data: string[] = [],
		reviewed: number[] = [];
	const subscription = terminal.onData((value) => data.push(value));
	const handler = createTerminalWheelEventHandler(
		browserTerminal,
		tracker.isActive,
		(lines) => reviewed.push(lines),
	);
	const write = (value: string) =>
		new Promise<void>((resolve) => terminal.write(value, resolve));
	const wheel = (deltaY: number, shiftKey = false) => {
		const event = new WheelEvent("wheel", { deltaY, cancelable: true });
		Object.defineProperty(event, "shiftKey", { value: shiftKey });
		return handler(event);
	};
	try {
		await write("shell history\r\n\x1b[?1049h\x1b[?1hTUI 中文 🙂");
		expect(wheel(-34)).toBe(false);
		expect(data).toEqual([]);
		expect(reviewed).toEqual([-2]);
		await write("\x1b[?1000h\x1b[?1006h");
		wheel(-34);
		wheel(17);
		expect(data).toEqual(["\x1b[<64;1;1M\x1b[<64;1;1M", "\x1b[<65;1;1M"]);
		const count = data.length;
		wheel(-17, true);
		expect(data).toHaveLength(count);
		expect(reviewed).toEqual([-2, -1]);
		await write("\x1b[?1000l\x1b[?1006l\x1b[?1049l");
		expect(wheel(-34)).toBe(true);
		expect(data).toHaveLength(count);
	} finally {
		subscription.dispose();
		tracker.dispose();
		terminal.dispose();
	}
});

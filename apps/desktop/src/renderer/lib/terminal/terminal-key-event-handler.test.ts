import { expect, test } from "bun:test";
import { Terminal as HeadlessTerminal } from "@xterm/headless";
import type { Terminal } from "@xterm/xterm";
import { createTerminalKeyEventHandler } from "./terminal-key-event-handler-core";

test.each([
	{ platform: "darwin", metaKey: true, ctrlKey: false, shiftKey: false },
	{ platform: "win32", metaKey: false, ctrlKey: true, shiftKey: false },
	{ platform: "linux", metaKey: false, ctrlKey: true, shiftKey: true },
])("native paste bypasses terminal key encoding on $platform", ({
	platform,
	...modifiers
}) => {
	const inputs: string[] = [];
	const terminal = {
		input: (text: string) => inputs.push(text),
		hasSelection: () => false,
		selectAll() {},
	} as unknown as Terminal;
	const handler = createTerminalKeyEventHandler(terminal, {
		platform,
		resolveHotkey: () => null,
	});
	const event = new KeyboardEvent("keydown", {
		key: "v",
		code: "KeyV",
		cancelable: true,
		...modifiers,
	});
	expect(handler(event)).toBe(false);
	expect(event.defaultPrevented).toBe(false);
	expect(inputs).toEqual([]);
});

test("Mac copy follows actual mouse and kitty mode transitions while retaining terminal selection and app hotkeys", async () => {
	const emulator = new HeadlessTerminal({ allowProposedApi: true });
	const raw = emulator as unknown as {
		_core: {
			optionsService: {
				rawOptions: { vtExtensions: { kittyKeyboard: boolean } };
			};
		};
	};
	raw._core.optionsService.rawOptions.vtExtensions = { kittyKeyboard: true };
	let selected = false;
	const terminal = Object.assign(emulator, {
		hasSelection: () => selected,
	}) as unknown as Terminal;
	const handler = createTerminalKeyEventHandler(terminal, {
		platform: "darwin",
		resolveHotkey: () => null,
	});
	const key = () =>
		new KeyboardEvent("keydown", {
			key: "c",
			code: "KeyC",
			metaKey: true,
			cancelable: true,
		});
	const write = (data: string) =>
		new Promise<void>((done) => emulator.write(data, done));
	try {
		expect(handler(key())).toBe(false);
		await write("\x1b[>1u");
		expect(handler(key())).toBe(false);
		await write("\x1b[?1000h");
		expect(emulator.modes.mouseTrackingMode).not.toBe("none");
		const forwarded = key();
		expect(handler(forwarded)).toBe(true);
		expect(forwarded.defaultPrevented).toBe(false);
		selected = true;
		const copy = key();
		expect(handler(copy)).toBe(false);
		expect(copy.defaultPrevented).toBe(false);
		selected = false;
		expect(
			createTerminalKeyEventHandler(terminal, {
				platform: "darwin",
				resolveHotkey: () => "bound",
			})(key()),
		).toBe(false);
		await write("\x1b[<u");
		expect(handler(key())).toBe(false);
		await write("\x1b[>1u\x1b[?1000l");
		expect(handler(key())).toBe(false);
	} finally {
		emulator.dispose();
	}
});

test("a direct Linux terminal can use Ctrl+V for the standard image clipboard pipeline", () => {
	const terminal = {
		input() {},
		hasSelection: () => false,
		selectAll() {},
	} as unknown as Terminal;
	const event = new KeyboardEvent("keydown", {
		key: "v",
		code: "KeyV",
		ctrlKey: true,
		cancelable: true,
	});
	expect(
		createTerminalKeyEventHandler(terminal, { platform: "linux" })(event),
	).toBe(true);
	expect(
		createTerminalKeyEventHandler(terminal, {
			platform: "linux",
			linuxCtrlVPaste: true,
		})(event),
	).toBe(false);
	expect(event.defaultPrevented).toBe(false);
});

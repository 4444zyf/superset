import { expect, test } from "bun:test";
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

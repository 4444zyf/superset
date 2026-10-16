import type { Terminal as XTerm } from "@xterm/xterm";
import { resolveHotkeyFromEvent } from "renderer/hotkeys";
import {
	createTerminalKeyEventHandler as createCore,
	installTerminalKeyEventHandler as installCore,
	type TerminalKeyEventHandlerOptions,
} from "./terminal-key-event-handler-core";
export type { TerminalKeyEventHandlerOptions } from "./terminal-key-event-handler-core";

export function createTerminalKeyEventHandler(
	terminal: XTerm,
	options: TerminalKeyEventHandlerOptions = {},
) {
	return createCore(terminal, {
		...options,
		resolveHotkey: options.resolveHotkey ?? resolveHotkeyFromEvent,
	});
}
export function installTerminalKeyEventHandler(
	terminal: XTerm,
	options: TerminalKeyEventHandlerOptions = {},
) {
	return installCore(terminal, {
		...options,
		resolveHotkey: options.resolveHotkey ?? resolveHotkeyFromEvent,
	});
}

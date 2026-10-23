import { PRODUCT_BRAND } from "@superset/shared/product-brand";
import type { IDisposable, Terminal } from "@xterm/xterm";

// Claude checks the prefix to choose wheel acceleration; OpenTUI checks
// the xterm.js substring to enable OSC 8 links.
export const TERMINAL_VERSION_NAME = `${PRODUCT_BRAND.displayName} (xterm.js)`;

export interface TerminalVersionReplyOptions {
	enabled?(): boolean;
	canRespond?(): boolean;
}

export function installTerminalVersionReply(
	terminal: Pick<Terminal, "parser" | "input">,
	options: TerminalVersionReplyOptions = {},
): IDisposable {
	return terminal.parser.registerCsiHandler(
		{ prefix: ">", final: "q" },
		(params) => {
			if (options.enabled?.() === false) return false;
			const first = params[0];
			if (typeof first === "number" && first > 0) return true;
			if (options.canRespond?.() === false) return true;
			terminal.input(`\x1bP>|${TERMINAL_VERSION_NAME}\x1b\\`, false);
			return true;
		},
	);
}

import { expect, test } from "bun:test";
import { Terminal } from "@xterm/headless";
import {
	installTerminalVersionReply,
	TERMINAL_VERSION_NAME,
} from "./terminal-version-reply";

async function replies(
	query: string,
	mode: "installed" | "stock" | "disposed",
) {
	const terminal = new Terminal({ allowProposedApi: true });
	if (mode !== "stock") {
		const registration = installTerminalVersionReply(terminal);
		if (mode === "disposed") registration.dispose();
	}
	const sent: string[] = [];
	terminal.onData((data) => sent.push(data));
	await new Promise<void>((resolve) => terminal.write(query, resolve));
	terminal.dispose();
	return sent;
}

test("XTVERSION keeps the product name and xterm marker without selecting the stock wheel mode", async () => {
	expect(await replies("\x1b[>q", "installed")).toEqual([
		"\x1bP>|Superset Remix (xterm.js)\x1b\\",
	]);
	expect(TERMINAL_VERSION_NAME.startsWith("xterm.js")).toBe(false);
	expect(TERMINAL_VERSION_NAME).toContain("xterm.js");
});

test("only the supported XTVERSION query replies once", async () => {
	expect(await replies("\x1b[>0q", "installed")).toEqual([
		`\x1bP>|${TERMINAL_VERSION_NAME}\x1b\\`,
	]);
	expect(await replies("\x1b[>1q", "installed")).toEqual([]);
});

test("disposing the custom reply restores xterm's original query behavior", async () => {
	const stock = await replies("\x1b[>q", "stock");
	expect(stock[0]).toStartWith("\x1bP>|xterm.js(");
	expect(await replies("\x1b[>q", "disposed")).toEqual(stock);
});

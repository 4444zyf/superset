import { expect, test } from "bun:test";
import { Terminal } from "@xterm/headless";
import { createTerminalReplayGate } from "./terminal-replay-gate";
import {
	installTerminalVersionReply,
	TERMINAL_VERSION_NAME,
} from "./terminal-version-reply";

test("queued history cannot answer a stale query even after the boundary arrives; live queries still reply", async () => {
	const terminal = new Terminal({ allowProposedApi: true });
	const gate = createTerminalReplayGate();
	installTerminalVersionReply(terminal, gate.versionReplyOptions);
	const sent: string[] = [];
	terminal.onData((data) => sent.push(data));
	gate.begin();
	gate.write(new TextEncoder().encode("\x1b[>q"), (data, done) =>
		terminal.write(data, done),
	);
	gate.end();
	await new Promise<void>((resolve) => terminal.write("", resolve));
	expect(sent).toEqual([]);
	await new Promise<void>((resolve) => terminal.write("\x1b[>q", resolve));
	expect(sent).toEqual([`\x1bP>|${TERMINAL_VERSION_NAME}\x1b\\`]);
	terminal.dispose();
});

test("a failed history write releases pending parser work and an old host keeps the stock response", async () => {
	const terminal = new Terminal({ allowProposedApi: true });
	const gate = createTerminalReplayGate();
	installTerminalVersionReply(terminal, gate.versionReplyOptions);
	const sent: string[] = [];
	terminal.onData((data) => sent.push(data));
	await new Promise<void>((resolve) => terminal.write("\x1b[>q", resolve));
	expect(sent[0]).toStartWith("\x1bP>|xterm.js(");
	gate.begin();
	expect(() =>
		gate.write(new Uint8Array(), () => {
			throw new Error("write rejected");
		}),
	).toThrow("write rejected");
	gate.end();
	await new Promise<void>((resolve) => terminal.write("\x1b[>q", resolve));
	expect(sent[1]).toBe(`\x1bP>|${TERMINAL_VERSION_NAME}\x1b\\`);
	terminal.dispose();
});

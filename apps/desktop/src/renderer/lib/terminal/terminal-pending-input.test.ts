import { expect, test } from "bun:test";
import { Terminal as HeadlessTerminal } from "@xterm/headless";
import { Terminal } from "@xterm/xterm";
import {
	listenTerminalInput,
	TerminalPendingInput,
} from "./terminal-pending-input";

test("pending input preserves Unicode and control keys once, expires as a whole, and clears on cancellation", () => {
	let now = 0;
	const queue = new TerminalPendingInput(() => now);
	queue.queue("typed 中文🙂");
	queue.queue("\x03\r");
	expect(queue.take()).toBe("typed 中文🙂\x03\r");
	expect(queue.take()).toBe("");
	queue.queue("stale prefix");
	now = 5001;
	queue.queue("\r");
	expect(queue.take()).toBe("");
	queue.queue("cancelled command\r");
	queue.clear();
	expect(queue.take()).toBe("");
});

test("overflow discards the entire burst, including a first oversized paste and later command terminators", () => {
	const queue = new TerminalPendingInput();
	queue.queue("x".repeat(8193));
	queue.queue("\r");
	expect(queue.take()).toBe("");
	queue.queue("prefix ");
	queue.queue("y".repeat(8192));
	queue.queue("\r");
	expect(queue.take()).toBe("");
	queue.queue("complete\r");
	expect(queue.take()).toBe("complete\r");
});

test.each([
	HeadlessTerminal,
	Terminal,
])("the pinned xterm core distinguishes user data from parser responses and releases both subscriptions", async (XTerm) => {
	const terminal = new XTerm({ allowProposedApi: true });
	const events: [string, boolean][] = [];
	const subscription = listenTerminalInput(terminal, (data, user) =>
		events.push([data, user]),
	);
	try {
		terminal.input("中文\r", true);
		await new Promise<void>((done) => terminal.write("\x1b[>q", done));
		terminal.input("\x03", true);
		expect(events[0]).toEqual(["中文\r", true]);
		expect(events[1]?.[0]).toStartWith("\x1bP>|xterm.js(");
		expect(events[1]?.[1]).toBe(false);
		expect(events[2]).toEqual(["\x03", true]);
		subscription.dispose();
		terminal.input("after dispose", true);
		expect(events).toHaveLength(3);
	} finally {
		subscription.dispose();
		terminal.dispose();
	}
});

test("a core without input provenance retains live data without guessing it is user input", () => {
	let emit!: (data: string) => void;
	const received: [string, boolean][] = [];
	const subscription = listenTerminalInput(
		{
			onData: (callback) => {
				emit = callback;
				return { dispose() {} };
			},
		},
		(data, user) => received.push([data, user]),
	);
	emit("old core input");
	expect(received).toEqual([["old core input", false]]);
	subscription.dispose();
});

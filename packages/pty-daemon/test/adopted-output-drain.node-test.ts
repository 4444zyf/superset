import { strict as assert } from "node:assert";
import { closeSync, openSync } from "node:fs";
import { PassThrough } from "node:stream";
import { test } from "node:test";
import { adoptFromFd } from "../src/Pty/index.ts";

test("a stopped adopted process drains its paused output before publishing exit", async (context) => {
	const fd = openSync("/dev/null", "r");
	const reader = new PassThrough();
	let pollTick = () => {};
	let probes = 0;
	const pty = adoptFromFd({
		fd,
		pid: process.pid,
		meta: { shell: "/bin/sh", argv: [], cols: 80, rows: 24 },
		readerFactory: () => reader,
		probePid: async () => {
			probes++;
			return false;
		},
		scheduleExitPoll: (tick) => {
			pollTick = tick;
			return setInterval(() => {}, 1000);
		},
	});
	context.after(() => {
		pty.dispose({ keepExitPolling: false });
		closeSync(fd);
	});
	let exits = 0;
	let markExited: () => void = () => {};
	const exited = new Promise<void>((resolve) => {
		markExited = resolve;
	});
	pty.onExit(() => {
		exits++;
		markExited();
	});
	const chunks: Buffer[] = [];
	pty.pause();
	pty.onData((chunk) => chunks.push(chunk));
	reader.end(Buffer.from("final unread output"));
	pollTick();
	await Promise.resolve();
	assert.equal(exits, 0);
	assert.equal(reader.destroyed, false);
	assert.equal(probes, 0);
	pty.resume();
	await exited;
	assert.equal(Buffer.concat(chunks).toString(), "final unread output");
	assert.equal(exits, 1);
});

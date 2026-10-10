import { expect, test } from "bun:test";
import type { ChildProcess, spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { runLocalImportProcess } from "./local-import-process";

test("split UTF-8 output preserves non-ASCII namespace paths", async () => {
	const stdout = new PassThrough(),
		stderr = new PassThrough();
	const child = new EventEmitter() as ChildProcess;
	Object.assign(child, { pid: 12345, stdout, stderr });
	const running = runLocalImportProcess({
		executable: "/app/electron",
		args: [],
		cwd: "/tmp",
		environment: {},
		spawn: (() => child) as typeof spawn,
	});
	const expected = JSON.stringify({
		journalPath: "/tmp/中文/state/import.json",
	});
	const bytes = Buffer.from(expected);
	const split = bytes.indexOf(Buffer.from("中")) + 1;
	stdout.write(bytes.subarray(0, split));
	stdout.write(bytes.subarray(split));
	child.emit("close", 0);
	expect(await running).toBe(expected);
});

test("output overflow waits for the child to die before releasing its caller", async () => {
	const stdout = new PassThrough(),
		stderr = new PassThrough();
	const child = new EventEmitter() as ChildProcess;
	const signals: string[] = [];
	let closed = false;
	Object.assign(child, {
		pid: 12345,
		stdout,
		stderr,
		kill(signal: string) {
			signals.push(signal);
			if (signal === "SIGKILL")
				queueMicrotask(() => {
					closed = true;
					child.emit("close", 1);
				});
			return true;
		},
	});
	let settled = false;
	const running = runLocalImportProcess({
		executable: "/app/electron",
		args: [],
		cwd: "/tmp",
		environment: {},
		spawn: (() => child) as typeof spawn,
		graceMs: 20,
	}).catch((error: Error) => {
		settled = true;
		expect(closed).toBe(true);
		return error.message;
	});
	stdout.write(Buffer.alloc(65537, 65));
	stdout.write("late chunk");
	await new Promise<void>((resolve) => setImmediate(resolve));
	expect(settled).toBe(false);
	expect(await running).toContain("response");
	expect(signals).toEqual(["SIGTERM", "SIGKILL"]);
	expect(stdout.destroyed).toBe(true);
	expect(stderr.destroyed).toBe(true);
});

test("deadline settles once after forced child cleanup", async () => {
	const child = new EventEmitter() as ChildProcess;
	const signals: string[] = [];
	Object.assign(child, {
		pid: 12345,
		stdout: new PassThrough(),
		stderr: new PassThrough(),
		kill(signal: string) {
			signals.push(signal);
			if (signal === "SIGKILL") child.emit("close", 1);
			return true;
		},
	});
	await expect(
		runLocalImportProcess({
			executable: "/app/electron",
			args: [],
			cwd: "/tmp",
			environment: {},
			spawn: (() => child) as typeof spawn,
			timeoutMs: 10,
			graceMs: 10,
		}),
	).rejects.toThrow("timed out");
	expect(signals).toEqual(["SIGTERM", "SIGKILL"]);
});

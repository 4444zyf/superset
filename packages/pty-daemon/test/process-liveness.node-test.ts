import { strict as assert } from "node:assert";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { test } from "node:test";
import * as processTree from "../src/process-tree.ts";

test("a terminated orphan is stopped even while its PID waits to be reaped", async (context) => {
	const parent = spawn(
		process.execPath,
		[
			"-e",
			"const {spawn}=require('node:child_process');const child=spawn('/bin/sh',['-c','kill -STOP $$'],{detached:true,stdio:'ignore'});console.log(child.pid);child.unref();",
		],
		{ stdio: ["ignore", "pipe", "inherit"] },
	);
	let output = "";
	parent.stdout.on("data", (chunk) => {
		output += chunk;
	});
	await once(parent, "exit");
	const pid = Number(output.trim());
	assert.ok(Number.isSafeInteger(pid) && pid > 1, "owned child PID expected");
	context.after(() => {
		try {
			process.kill(pid, "SIGKILL");
		} catch (error) {
			assert.equal((error as NodeJS.ErrnoException).code, "ESRCH");
		}
	});
	assert.equal(await processTree.isPidRunning(pid), true);
	process.kill(pid, "SIGKILL");
	assert.equal(await processTree.isPidRunning(pid), false);
});

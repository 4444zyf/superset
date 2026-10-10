import assert from "node:assert/strict";
import { type ChildProcess, spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { spawnOwnedSsh } from "./ssh-process.ts";

function exited(child: ChildProcess): Promise<void> {
	if (child.exitCode !== null || child.signalCode !== null)
		return Promise.resolve();
	return new Promise((resolve, reject) => {
		child.once("exit", () => resolve());
		child.once("error", reject);
	});
}

test("an SSH process that exits also removes its own proxy subprocess", async () => {
	const directory = await mkdtemp(join(tmpdir(), "superset-ssh-proxy-test-"));
	const statePath = join(directory, "proxy.json");
	const proxySource = `const { createServer }=require('node:net'); const { writeFileSync }=require('node:fs'); process.on('SIGTERM',()=>{}); const server=createServer(); server.listen(0,'127.0.0.1',()=>writeFileSync(process.argv[1],JSON.stringify({pid:process.pid,port:server.address().port})));`;
	const source = `const {spawn}=require('node:child_process'); const {existsSync}=require('node:fs'); spawn(process.execPath,['-e',${JSON.stringify(proxySource)},'--',process.argv[1]],{stdio:'ignore'}); const check=setInterval(()=>{ if(existsSync(process.argv[1])) {clearInterval(check); process.exit(7);} },10);`;
	const wrapper = spawnOwnedSsh(
		process.execPath,
		["-e", source, "--", statePath],
		{
			stdio: "ignore",
			execPath: process.execPath,
			pollIntervalMs: 10,
			gracePeriodMs: 30,
		},
	);
	let state: { pid: number; port: number } | undefined;
	try {
		await exited(wrapper);
		state = JSON.parse(await readFile(statePath, "utf8"));
		assert.ok(state);
		assert.equal(
			await listens(state.port),
			false,
			"The SSH process exited but its proxy subprocess remained",
		);
	} finally {
		wrapper.kill("SIGKILL");
		if (state) {
			try {
				process.kill(state.pid, "SIGKILL");
			} catch {}
		}
		await rm(directory, { recursive: true, force: true });
	}
});

function listens(port: number): Promise<boolean> {
	return new Promise((resolve) => {
		const socket = connect({ host: "127.0.0.1", port });
		socket.once("connect", () => {
			socket.destroy();
			resolve(true);
		});
		socket.once("error", () => resolve(false));
	});
}

for (const ignoresTermination of [false, true]) {
	test(`killing the client closes its SSH listener even when TERM is ignored: ${ignoresTermination}`, async () => {
		const directory = await mkdtemp(
			join(tmpdir(), "superset-ssh-parent-test-"),
		);
		const statePath = join(directory, "child.json");
		const moduleUrl = pathToFileURL(
			join(import.meta.dirname, "ssh-process.ts"),
		).href;
		const childProgram = `const { createServer } = require('node:net'); const { writeFileSync } = require('node:fs'); ${ignoresTermination ? "process.on('SIGTERM',()=>{});" : ""} const server=createServer(); server.listen(0,'127.0.0.1',()=>{writeFileSync(process.argv[1],JSON.stringify({pid:process.pid,port:server.address().port}));});`;
		const parentPath = join(directory, "parent.mjs");
		await writeFile(
			parentPath,
			`import { spawnOwnedSsh } from ${JSON.stringify(moduleUrl)}; spawnOwnedSsh(process.execPath,['-e',${JSON.stringify(childProgram)},'--',${JSON.stringify(statePath)}],{stdio:'ignore',execPath:process.execPath,pollIntervalMs:10,gracePeriodMs:30}); setInterval(()=>{},1000);`,
		);
		const parent = spawn(
			process.execPath,
			["--experimental-strip-types", parentPath],
			{ stdio: ["ignore", "ignore", "pipe"] },
		);
		let state: { pid: number; port: number } | undefined;
		let errors = "";
		parent.stderr?.on("data", (bytes) => {
			errors += bytes.toString();
		});
		try {
			for (let attempt = 0; attempt < 100; attempt++) {
				try {
					state = JSON.parse(await readFile(statePath, "utf8"));
					break;
				} catch {
					await new Promise((resolve) => setTimeout(resolve, 10));
				}
			}
			assert.ok(state, `Fixture failed to start: ${errors}`);
			assert.equal(await listens(state.port), true);
			parent.kill("SIGKILL");
			await exited(parent);
			let open = true;
			for (let attempt = 0; attempt < 100 && open; attempt++) {
				open = await listens(state.port);
				if (open) await new Promise((resolve) => setTimeout(resolve, 10));
			}
			assert.equal(
				open,
				false,
				"The client died but its SSH listener remained available",
			);
		} finally {
			parent.kill("SIGKILL");
			if (state) {
				try {
					process.kill(state.pid, "SIGKILL");
				} catch {}
			}
			await rm(directory, { recursive: true, force: true });
		}
	});
}

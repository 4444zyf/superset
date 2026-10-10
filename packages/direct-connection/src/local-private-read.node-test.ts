import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";

test("a FIFO cannot block local identity validation before its file type is checked", async () => {
	const directory = mkdtempSync(join(tmpdir(), "superset-local-fifo-test-"));
	try {
		execFileSync("mkfifo", ["-m", "600", join(directory, "identity.json")]);
		const script = `import { LocalBackend } from ${JSON.stringify(pathToFileURL(join(import.meta.dirname, "local.ts")).href)}; process.once('message', async () => { const backend=new LocalBackend(${JSON.stringify({ dataDir: directory, execPath: process.execPath, supervisorPath: join(directory, "supervisor.js"), hostServicePath: join(directory, "backend.js"), migrationsFolder: directory, chatMigrationsFolder: directory })}); try {await backend.connect(); process.exit(2);} catch(error) {if (!error.message.includes('owner-only regular files')) throw error; process.exit(0);} }); process.send('ready');`;
		const child = spawn(
			process.execPath,
			["--import", "tsx", "--input-type=module", "-e", script],
			{ stdio: ["ignore", "pipe", "pipe", "ipc"] },
		);
		const exited = once(child, "close");
		let diagnostics = "";
		child.stderr?.on("data", (chunk) => {
			diagnostics += chunk;
		});
		let deadline: ReturnType<typeof setTimeout> | undefined;
		try {
			await Promise.race([
				once(child, "message"),
				exited.then(() => {
					throw new Error(`Validator did not load: ${diagnostics}`);
				}),
			]);
			deadline = setTimeout(() => child.kill("SIGKILL"), 800);
			child.send("validate");
			const [code, signal] = await exited;
			assert.equal(signal, null, `Private reader blocked: ${diagnostics}`);
			assert.equal(code, 0, diagnostics);
		} finally {
			clearTimeout(deadline);
			if (child.exitCode === null && child.signalCode === null)
				child.kill("SIGKILL");
			await exited;
		}
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
});

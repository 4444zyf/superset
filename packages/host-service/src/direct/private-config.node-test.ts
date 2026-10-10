import { strict as assert } from "node:assert";
import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

test("a private FIFO cannot block secret or configuration validation before backend shutdown is available", async () => {
	const root = mkdtempSync(join(tmpdir(), "direct-private-config-"));
	const path = join(root, "fifo");
	execFileSync("mkfifo", ["-m", "600", path]);
	try {
		const script = `import { readDirectSecret, loadDirectConfig } from ${JSON.stringify(new URL("./config.ts", import.meta.url).href)}; process.once('message', () => { for (const read of [readDirectSecret, loadDirectConfig]) { try { read(${JSON.stringify(path)}); process.exit(2); } catch (error) { if (!String(error).includes('regular file')) throw error; } } process.exit(0); }); process.send('ready');`;
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
		const oversized = join(root, "oversized.json");
		writeFileSync(oversized, Buffer.alloc(65537, " "), { mode: 0o600 });
		const { loadDirectConfig } = await import("./config.ts");
		assert.throws(() => loadDirectConfig(oversized), /size limit/);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

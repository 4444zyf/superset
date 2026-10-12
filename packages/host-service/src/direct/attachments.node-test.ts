import { strict as assert } from "node:assert";
import { execFileSync, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

for (const member of ["metadata", "payload"] as const) {
	test(`a ${member} FIFO cannot block direct attachment requests`, async () => {
		const home = mkdtempSync(join(tmpdir(), "direct-attachment-fifo-"));
		const id = randomUUID();
		const directory = join(home, "attachments", id);
		mkdirSync(directory, { recursive: true, mode: 0o700 });
		const metadata = join(directory, "metadata.json");
		const payload = join(directory, `${id}.txt`);
		writeFileSync(
			metadata,
			JSON.stringify({
				attachmentId: id,
				mediaType: "text/plain",
				sizeBytes: 8,
				createdAt: Date.now(),
			}),
			{ mode: 0o600 },
		);
		writeFileSync(payload, "original", { mode: 0o600 });
		const fifo = member === "metadata" ? metadata : payload;
		rmSync(fifo);
		execFileSync("mkfifo", ["-m", "600", fifo]);
		const script = `import { Hono } from 'hono'; import { registerDirectAttachmentRoute } from ${JSON.stringify(new URL("./attachments.ts", import.meta.url).href)}; const app = new Hono(); registerDirectAttachmentRoute(app, ${JSON.stringify(home)}); process.once('message', async () => { const response = await app.request('/attachments/${id}'); process.exit(response.status === 404 ? 0 : 2); }); process.send('ready');`;
		const child = spawn(
			process.execPath,
			["--import", "tsx", "--input-type=module", "-e", script],
			{ stdio: ["ignore", "pipe", "pipe", "ipc"] },
		);
		const closed = once(child, "close");
		let diagnostics = "";
		child.stderr?.on("data", (chunk) => {
			diagnostics += chunk;
		});
		let deadline: ReturnType<typeof setTimeout> | undefined;
		try {
			await Promise.race([
				once(child, "message"),
				closed.then(() => {
					throw new Error(`Attachment route failed to load: ${diagnostics}`);
				}),
			]);
			deadline = setTimeout(() => child.kill("SIGKILL"), 800);
			child.send("request");
			const [code, signal] = await closed;
			assert.equal(
				signal,
				null,
				`Attachment route blocked on ${member}: ${diagnostics}`,
			);
			assert.equal(code, 0, diagnostics);
		} finally {
			clearTimeout(deadline);
			if (child.exitCode === null && child.signalCode === null)
				child.kill("SIGKILL");
			await closed;
			rmSync(home, { recursive: true, force: true });
		}
	});
}

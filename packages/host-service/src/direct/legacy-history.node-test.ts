import { strict as assert } from "node:assert";
import { execFileSync, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

test("a static-history metadata FIFO cannot block the local reader", async () => {
	const homeDir = mkdtempSync(join(tmpdir(), "legacy-history-fifo-"));
	const namespaceId = randomUUID(),
		workspaceId = randomUUID(),
		terminalId = randomUUID();
	const dir = join(
		homeDir,
		"host",
		namespaceId,
		"legacy-history",
		workspaceId,
		terminalId,
	);
	mkdirSync(dir, { recursive: true, mode: 0o700 });
	execFileSync("mkfifo", ["-m", "600", join(dir, "meta.json")]);
	const script = `import {listImportedLegacyHistory} from ${JSON.stringify(new URL("./legacy-history.ts", import.meta.url).href)}; process.once('message',()=>{try{listImportedLegacyHistory(${JSON.stringify({ homeDir, namespaceId })});process.exit(2)}catch(error){if(!String(error).includes('regular files'))throw error;process.exit(0)}});process.send('ready');`;
	const child = spawn(
		process.execPath,
		["--import", "tsx", "--input-type=module", "-e", script],
		{ stdio: ["ignore", "pipe", "pipe", "ipc"] },
	);
	let diagnostic = "";
	child.stderr?.on("data", (chunk) => {
		diagnostic += chunk.toString();
	});
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		const closed = once(child, "close");
		await once(child, "message");
		timer = setTimeout(() => child.kill("SIGKILL"), 800);
		child.send("read");
		const [code, signal] = await closed;
		assert.equal(
			signal,
			null,
			diagnostic || "FIFO read blocked until the child was killed",
		);
		assert.equal(code, 0, diagnostic);
	} finally {
		if (timer) clearTimeout(timer);
		if (child.exitCode === null && child.signalCode === null)
			child.kill("SIGKILL");
		rmSync(homeDir, { recursive: true, force: true });
	}
});

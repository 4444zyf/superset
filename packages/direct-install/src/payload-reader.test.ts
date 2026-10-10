import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("a substituted FIFO payload reader terminates before its enclosing installer deadline", () => {
	const home = mkdtempSync(join(tmpdir(), "direct-payload-reader-"));
	const fifo = join(home, "incoming-file");
	try {
		expect(spawnSync("/usr/bin/mkfifo", ["-m", "600", fifo]).status).toBe(0);
		const child = spawnSync(
			process.execPath,
			[
				"-e",
				`
import { readIncomingPayload } from ${JSON.stringify(join(import.meta.dir, "payload-reader.ts"))};
try { readIncomingPayload({path:${JSON.stringify(fifo)},size:32,uid:process.getuid(),gid:process.getgid(),userHome:${JSON.stringify(home)},timeoutMs:25}); process.exitCode=1 }
catch { console.log("reader-rejected") }
`,
			],
			{ timeout: 400, killSignal: "SIGKILL", encoding: "utf8" },
		);
		expect(child.status).toBe(0);
		expect(child.stdout.trim()).toBe("reader-rejected");
	} finally {
		rmSync(home, { recursive: true, force: true });
	}
});

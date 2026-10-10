import { afterEach, expect, test } from "bun:test";
import { execFile } from "node:child_process";
import {
	chmodSync,
	mkdirSync,
	mkdtempSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { readPrivateBackendFile } from "./health";

const roots: string[] = [];
afterEach(() => {
	for (const root of roots.splice(0))
		rmSync(root, { recursive: true, force: true });
});
test("refuses a substituted credential symlink before the health request", () => {
	const root = mkdtempSync(join(tmpdir(), "direct-health-"));
	roots.push(root);
	mkdirSync(join(root, "credentials"));
	writeFileSync(join(root, "unrelated-secret"), "a".repeat(64), {
		mode: 0o600,
	});
	symlinkSync(
		join(root, "unrelated-secret"),
		join(root, "credentials/host-secret"),
	);
	expect(() =>
		readPrivateBackendFile(join(root, "credentials/host-secret"), 1024),
	).toThrow();
});
test("requires owner-only permissions and a bounded regular file", () => {
	const root = mkdtempSync(join(tmpdir(), "direct-health-"));
	roots.push(root);
	const path = join(root, "secret");
	writeFileSync(path, "a".repeat(64), { mode: 0o644 });
	chmodSync(path, 0o644);
	expect(() => readPrivateBackendFile(path, 1024)).toThrow("private");
});
test.skipIf(process.platform === "win32")(
	"a credential FIFO is rejected before any blocking read",
	async () => {
		const root = mkdtempSync(join(tmpdir(), "direct-fifo-"));
		roots.push(root);
		const path = join(root, "secret");
		const run = promisify(execFile);
		await run("/usr/bin/mkfifo", ["-m", "600", path]);
		const source = `import {readPrivateBackendFile} from ${JSON.stringify(join(import.meta.dir, "health.ts"))};try{readPrivateBackendFile(${JSON.stringify(path)},1024);throw new Error('unexpected FIFO accepted');}catch(error){if(!error.message.includes('private'))throw error;process.stdout.write('rejected-special-file');}`;
		const result = await run(process.execPath, ["--eval", source], {
			timeout: 1000,
		});
		expect(result.stdout).toBe("rejected-special-file");
	},
);

import { afterEach, expect, test } from "bun:test";
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

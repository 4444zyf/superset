import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { acquireDirectProcessLock } from "./process-lock";

const roots: string[] = [];
afterEach(() => {
	for (const root of roots.splice(0))
		rmSync(root, { recursive: true, force: true });
});

test("a second backend cannot write the same namespace while its owner is alive", () => {
	const root = mkdtempSync(join(tmpdir(), "direct-lock-"));
	roots.push(root);
	const lockPath = join(root, "backend.lock");
	const release = acquireDirectProcessLock(lockPath);
	expect(() => acquireDirectProcessLock(lockPath)).toThrow("already running");
	release();
	const nextRelease = acquireDirectProcessLock(lockPath);
	nextRelease();
});

test("a dead predecessor's process lock can be reclaimed without deleting data", () => {
	const root = mkdtempSync(join(tmpdir(), "direct-lock-stale-"));
	roots.push(root);
	const lockPath = join(root, "backend.lock");
	symlinkSync(
		"superset-direct-lock-2147483647-00000000-0000-4000-8000-000000000001",
		lockPath,
	);
	symlinkSync(
		"superset-direct-lock-2147483647-00000000-0000-4000-8000-000000000002",
		`${lockPath}.recovery`,
	);
	const release = acquireDirectProcessLock(lockPath);
	release();
});

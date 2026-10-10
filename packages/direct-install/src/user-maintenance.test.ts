import { expect, test } from "bun:test";
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { maintainBackendLogs, pruneManagedBackups } from "./user-maintenance";

test("log capacity maintenance retains a bounded tail while keeping launchd's open log inode", () => {
	const home = mkdtempSync(join(tmpdir(), "direct-logs-"));
	mkdirSync(join(home, "logs"), { mode: 0o700 });
	const path = join(home, "logs/service.log");
	writeFileSync(path, "older-output\nlatest-output\n", { mode: 0o600 });
	const inode = statSync(path).ino;
	try {
		maintainBackendLogs(home, { maximumBytes: 16, tailBytes: 14 });
		expect(readFileSync(path, "utf8")).toBe("latest-output\n");
		expect(statSync(path).ino).toBe(inode);
	} finally {
		rmSync(home, { recursive: true, force: true });
	}
});
test("snapshot pruning retains the active transaction and a previous completed backup and ignores foreign directories", () => {
	const home = mkdtempSync(join(tmpdir(), "direct-backups-"));
	const backupRoot = join(home, "state/backups");
	mkdirSync(backupRoot, { recursive: true, mode: 0o700 });
	const ids = [
		"11111111-1111-1111-1111-111111111111",
		"22222222-2222-2222-2222-222222222222",
		"33333333-3333-3333-3333-333333333333",
		"44444444-4444-4444-4444-444444444444",
	] as const;
	for (const [i, id] of ids.entries()) {
		mkdirSync(join(backupRoot, id), { mode: 0o700 });
		writeFileSync(
			join(backupRoot, id, "snapshot.json"),
			JSON.stringify({
				formatVersion: 1,
				transactionId: id,
				phase: i === 3 ? "building" : "complete",
				createdAt: i,
			}),
			{ mode: 0o600 },
		);
	}
	mkdirSync(join(backupRoot, "unrecognized"));
	try {
		expect(pruneManagedBackups(home, ids[2] ?? "", 2).sort()).toEqual([
			ids[0],
			ids[3],
		]);
		expect(statSync(join(backupRoot, ids[1] ?? "")).isDirectory()).toBe(true);
		expect(statSync(join(backupRoot, "unrecognized")).isDirectory()).toBe(true);
	} finally {
		rmSync(home, { recursive: true, force: true });
	}
});

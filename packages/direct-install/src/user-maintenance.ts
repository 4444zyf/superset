import {
	closeSync,
	constants,
	existsSync,
	fstatSync,
	fsyncSync,
	ftruncateSync,
	lstatSync,
	openSync,
	readdirSync,
	readSync,
	rmSync,
	writeSync,
} from "node:fs";
import { join } from "node:path";
import { readPrivateBackendFile } from "./health";

function privateDirectory(path: string, uid: number): void {
	const stat = lstatSync(path);
	if (!stat.isDirectory() || stat.uid !== uid || (stat.mode & 0o077) !== 0)
		throw new Error(
			"Maintenance directories must be private and owned by their service user",
		);
}
export function maintainBackendLogs(
	homeDir: string,
	options: { maximumBytes?: number; tailBytes?: number } = {},
): void {
	const uid = process.getuid?.();
	if (uid === undefined) return;
	const maximum = options.maximumBytes ?? 10 * 1024 * 1024;
	const tail = options.tailBytes ?? 1024 * 1024;
	if (
		!Number.isSafeInteger(maximum) ||
		!Number.isSafeInteger(tail) ||
		tail < 1 ||
		tail > maximum ||
		maximum > 64 * 1024 * 1024
	)
		throw new Error("Invalid log capacity policy");
	privateDirectory(homeDir, uid);
	const root = join(homeDir, "logs");
	if (!existsSync(root)) return;
	privateDirectory(root, uid);
	for (const name of ["service.log", "service-error.log"]) {
		const path = join(root, name);
		if (!existsSync(path)) continue;
		const fd = openSync(path, constants.O_RDWR | constants.O_NOFOLLOW);
		try {
			const stat = fstatSync(fd);
			if (!stat.isFile() || stat.uid !== uid || (stat.mode & 0o077) !== 0)
				throw new Error(
					"Backend logs must be private regular files owned by the service user",
				);
			if (stat.size <= maximum) continue;
			const bytes = Buffer.alloc(tail);
			const count = readSync(fd, bytes, 0, tail, stat.size - tail);
			ftruncateSync(fd, 0);
			writeSync(fd, bytes, 0, count, 0);
			fsyncSync(fd);
		} finally {
			closeSync(fd);
		}
	}
}
export function pruneManagedBackups(
	homeDir: string,
	retainedTransactionId: string,
	maximumSnapshots = 2,
): string[] {
	const uid = process.getuid?.();
	if (uid === undefined) return [];
	if (
		!Number.isSafeInteger(maximumSnapshots) ||
		maximumSnapshots < 1 ||
		maximumSnapshots > 10
	)
		throw new Error("Invalid snapshot retention policy");
	const root = join(homeDir, "state/backups");
	if (!existsSync(root)) return [];
	for (const directory of [homeDir, join(homeDir, "state"), root])
		privateDirectory(directory, uid);
	const managed: { id: string; createdAt: number }[] = [];
	for (const id of readdirSync(root)) {
		if (
			!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(id)
		)
			continue;
		const path = join(root, id);
		privateDirectory(path, uid);
		const marker = join(path, "snapshot.json");
		if (!existsSync(marker)) continue;
		const snapshot = JSON.parse(readPrivateBackendFile(marker, 4096)) as {
			formatVersion: number;
			transactionId: string;
			createdAt: number;
		};
		if (
			snapshot.formatVersion !== 1 ||
			snapshot.transactionId !== id ||
			!Number.isFinite(snapshot.createdAt)
		)
			throw new Error("Invalid managed snapshot marker");
		managed.push({ id, createdAt: snapshot.createdAt });
	}
	const retained = new Set([retainedTransactionId]);
	for (const item of managed.sort((a, b) => b.createdAt - a.createdAt)) {
		if (retained.size >= maximumSnapshots) break;
		retained.add(item.id);
	}
	const removed = managed
		.filter((item) => !retained.has(item.id))
		.map((item) => item.id);
	for (const id of removed)
		rmSync(join(root, id), { recursive: true, force: true });
	return removed;
}

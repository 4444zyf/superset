import { randomUUID } from "node:crypto";
import { lstatSync, readlinkSync, rmSync, symlinkSync } from "node:fs";

export function acquireInstallerLock(path: string): () => void {
	return acquireAtomicLock(path, 0);
}

function lockOwner(path: string): number {
	if (!lstatSync(path).isSymbolicLink())
		throw new Error("Invalid installation lock; explicit repair is required");
	const owner = /^superset-lock-(\d+)-[a-f0-9-]{36}$/.exec(readlinkSync(path));
	if (!owner) throw new Error("Invalid installation lock owner");
	const pid = Number(owner[1]);
	if (!Number.isSafeInteger(pid) || pid <= 0 || pid > 2147483647)
		throw new Error("Invalid installation lock owner PID");
	return pid;
}
function isLive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ESRCH") return false;
		throw error;
	}
}
function acquireAtomicLock(path: string, depth: number): () => void {
	if (depth > 16)
		throw new Error("Installation lock recovery requires explicit repair");
	const owner = `superset-lock-${process.pid}-${randomUUID()}`;
	try {
		symlinkSync(owner, path);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
		if (isLive(lockOwner(path)))
			throw new Error("A backend installation is in progress");
		const releaseRecovery = acquireAtomicLock(`${path}.recovery`, depth + 1);
		try {
			if (isLive(lockOwner(path)))
				throw new Error("A backend installation is in progress");
			rmSync(path);
			symlinkSync(owner, path);
		} finally {
			releaseRecovery();
		}
	}
	return () => {
		try {
			if (readlinkSync(path) === owner) rmSync(path);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
		}
	};
}

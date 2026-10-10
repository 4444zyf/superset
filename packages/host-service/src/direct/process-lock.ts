import { randomUUID } from "node:crypto";
import {
	lstatSync,
	mkdirSync,
	readlinkSync,
	rmSync,
	symlinkSync,
} from "node:fs";
import { dirname } from "node:path";

function owner(path: string): number {
	if (!lstatSync(path).isSymbolicLink())
		throw new Error(
			"Invalid backend process lock; explicit repair is required",
		);
	const target = /^superset-direct-lock-(\d+)-[a-f0-9-]{36}$/.exec(
		readlinkSync(path),
	);
	if (!target)
		throw new Error(
			"Invalid backend process lock owner; explicit repair is required",
		);
	return Number(target[1]);
}

function isAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return (error as NodeJS.ErrnoException).code !== "ESRCH";
	}
}

function acquire(path: string, depth: number): () => void {
	if (depth > 16)
		throw new Error("Backend lock recovery requires explicit repair");
	const target = `superset-direct-lock-${process.pid}-${randomUUID()}`;
	try {
		symlinkSync(target, path);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
		if (isAlive(owner(path)))
			throw new Error("A backend process is already running");
		const releaseRecovery = acquire(`${path}.recovery`, depth + 1);
		try {
			if (isAlive(owner(path)))
				throw new Error("A backend process is already running");
			rmSync(path);
			symlinkSync(target, path);
		} finally {
			releaseRecovery();
		}
	}
	return () => {
		try {
			if (readlinkSync(path) === target) rmSync(path);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
		}
	};
}

export function acquireDirectProcessLock(path: string): () => void {
	mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
	return acquire(path, 0);
}

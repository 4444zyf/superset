import {
	existsSync,
	lstatSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	rmSync,
	type Stats,
} from "node:fs";
import { join } from "node:path";
import { atomicPrivateJson, SYSTEM_ROOT } from "./control-runtime";

const RELEASE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}-[a-f0-9]{24}$/;
export interface CachedRelease {
	id: string;
	bytes: number;
	modified: number;
}
export function planGarbageCollection(
	releases: CachedRelease[],
	retained: Set<string>,
	maximumCacheBytes: number,
): string[] {
	if (!Number.isSafeInteger(maximumCacheBytes) || maximumCacheBytes < 0)
		throw new Error("Invalid runtime cache capacity");
	const unused = releases
		.filter((release) => !retained.has(release.id))
		.sort((a, b) => a.modified - b.modified);
	let bytes = unused.reduce((sum, release) => sum + release.bytes, 0);
	const remove: string[] = [];
	for (const release of unused) {
		if (bytes <= maximumCacheBytes) break;
		remove.push(release.id);
		bytes -= release.bytes;
	}
	return remove;
}
function rootStat(path: string): Stats {
	const stat = lstatSync(path);
	if (stat.isSymbolicLink() || stat.uid !== 0 || (stat.mode & 0o022) !== 0)
		throw new Error("Runtime retention must use root-owned immutable paths");
	return stat;
}
function readRetention(path: string): { uid: number; releaseIds: string[] } {
	const stat = rootStat(path);
	if (!stat.isFile() || stat.size > 65536)
		throw new Error("Invalid runtime retention record");
	const record = JSON.parse(readFileSync(path, "utf8")) as {
		uid: number;
		releaseIds: string[];
	};
	if (
		!Number.isSafeInteger(record.uid) ||
		record.uid < 1 ||
		!Array.isArray(record.releaseIds) ||
		record.releaseIds.length > 16 ||
		record.releaseIds.some((id) => !RELEASE_ID.test(id))
	)
		throw new Error("Invalid retained release identities");
	return record;
}
export function retainUserRuntimes(uid: number, releaseIds: string[]): void {
	if (
		process.getuid?.() !== 0 ||
		!Number.isSafeInteger(uid) ||
		uid < 1 ||
		releaseIds.length > 16 ||
		releaseIds.some((id) => !RELEASE_ID.test(id))
	)
		throw new Error("Invalid root runtime retention update");
	const root = join(SYSTEM_ROOT, "retention");
	mkdirSync(root, { recursive: true, mode: 0o700 });
	rootStat(root);
	atomicPrivateJson(join(root, `${uid}.json`), {
		uid,
		releaseIds: [...new Set(releaseIds)],
	});
}
function treeBytes(root: string): number {
	const stat = rootStat(root);
	if (stat.isDirectory())
		return readdirSync(root).reduce(
			(sum, name) => sum + treeBytes(join(root, name)),
			0,
		);
	if (!stat.isFile()) throw new Error("Invalid runtime cache file");
	return stat.size;
}
export function reclaimUnusedRuntimes(
	options: {
		maximumCacheBytes?: number;
		launchDaemonRoot?: string;
		activeInstallId?: string;
	} = {},
): string[] {
	if (process.getuid?.() !== 0)
		throw new Error(
			"Runtime cache reclamation requires the privileged installer",
		);
	const records = join(SYSTEM_ROOT, "retention");
	if (!existsSync(records)) return [];
	rootStat(records);
	const retained = new Set<string>();
	const knownUsers = new Set<number>();
	for (const name of readdirSync(records)) {
		if (!/^\d+\.json$/.test(name))
			throw new Error("Unrecognized retention metadata");
		const record = readRetention(join(records, name));
		if (name !== `${record.uid}.json`)
			throw new Error("Retention UID mismatch");
		knownUsers.add(record.uid);
		for (const id of record.releaseIds) retained.add(id);
	}
	const jobs = options.launchDaemonRoot ?? "/Library/LaunchDaemons";
	for (const name of readdirSync(jobs)) {
		const match = /^io\.superset\.direct\.backend\.(\d+)\.plist$/.exec(name);
		if (!match) continue;
		if (!knownUsers.has(Number(match[1]))) return [];
		const path = join(jobs, name);
		const stat = rootStat(path);
		if (!stat.isFile() || stat.size > 65536)
			throw new Error("Invalid launchd retention job");
		const launcher = readFileSync(path, "utf8").match(
			/<key>ProgramArguments<\/key><array><string>\/Library\/Application Support\/SupersetDirect\/runtime\/([^<]+)\/lib\/node<\/string>/,
		)?.[1];
		if (!launcher || !RELEASE_ID.test(launcher)) return [];
		retained.add(launcher);
	}
	const runtime = join(SYSTEM_ROOT, "runtime");
	rootStat(runtime);
	const releases: CachedRelease[] = [];
	for (const name of readdirSync(runtime)) {
		const path = join(runtime, name);
		const stat = rootStat(path);
		if (RELEASE_ID.test(name)) {
			releases.push({
				id: name,
				bytes: treeBytes(path),
				modified: stat.mtimeMs,
			});
			continue;
		}
		const partial =
			/^([A-Za-z0-9][A-Za-z0-9._-]{0,63}-[a-f0-9]{24})\.([a-f0-9-]{36})\.partial$/.exec(
				name,
			);
		if (
			partial &&
			partial[2] !== options.activeInstallId &&
			Date.now() - stat.mtimeMs > 24 * 60 * 60 * 1000
		)
			rmSync(path, { recursive: true, force: true });
	}
	const remove = planGarbageCollection(
		releases,
		retained,
		options.maximumCacheBytes ?? 512 * 1024 * 1024,
	);
	for (const id of remove)
		rmSync(join(runtime, id), { recursive: true, force: true });
	return remove;
}

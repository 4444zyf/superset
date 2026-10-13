import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGunzip } from "node:zlib";
import { create, Parser } from "tar";
import {
	type ReleaseFile,
	safeReleasePath,
	type VerifiedRelease,
} from "./release";

export async function createReleaseArchive(
	root: string,
	destination: string,
	files: readonly ReleaseFile[],
	level: number,
): Promise<void> {
	if (![1, 6].includes(level))
		throw new Error("Unsupported release compression level");
	await create(
		{
			cwd: root,
			file: destination,
			gzip: { level },
			portable: true,
			noMtime: true,
			strict: true,
			follow: false,
			noDirRecurse: true,
		},
		files.map((file) => file.path).sort(),
	);
}

export async function extractReleaseArchive(
	snapshot: string,
	destination: string,
	verified: VerifiedRelease,
	onProgress?: (bytes: number, files: number) => void,
	maxWriters = 4,
): Promise<void> {
	if (![1, 4, 8].includes(maxWriters))
		throw new Error("Invalid archive writer bound");
	const archive = verified.manifest.archive;
	if (!archive) throw new Error("A signed archive manifest is required");
	const expected = new Map(
		verified.manifest.files.map((file) => [file.path, file]),
	);
	const seen = new Set<string>();
	let expanded = 0;
	let completed = 0;
	let lastProgress = 0;
	let failure: Error | undefined;
	const archiveHash = createHash("sha256");
	let archiveBytes = 0;
	const archiveDigest = new Transform({
		transform(chunk: Buffer, _encoding, callback) {
			archiveBytes += chunk.length;
			if (archiveBytes > archive.size)
				return callback(new Error("Archive exceeds signed size"));
			archiveHash.update(chunk);
			callback(null, chunk);
		},
	});
	const writes = new Set<Promise<void>>();
	const directories = new Map<string, Promise<void>>();
	const ensureDirectory = (path: string) => {
		let pending = directories.get(path);
		if (!pending) {
			pending = mkdir(path, { recursive: true, mode: 0o755 }).then(() => {});
			directories.set(path, pending);
		}
		return pending;
	};
	let verifiedFiles = 0;
	const parser = new Parser({
		strict: true,
		maxMetaEntrySize: 4096,
		onReadEntry: (entry) => {
			try {
				safeReleasePath(entry.path);
				const file = expected.get(entry.path);
				if (
					entry.type !== "File" ||
					!file ||
					seen.has(entry.path) ||
					entry.size !== file.size ||
					((entry.mode ?? 0) & 0o7777) !== file.mode ||
					entry.linkpath
				)
					throw new Error("Unexpected archive entry, type, size or mode");
				seen.add(entry.path);
				const slot =
					writes.size >= maxWriters ? Promise.race(writes) : Promise.resolve();
				const write = (async () => {
					await slot;
					if (failure) throw failure;
					const path = join(destination, file.path);
					await ensureDirectory(dirname(path));
					const hash = createHash("sha256");
					let size = 0;
					const digest = new Transform({
						transform(chunk: Buffer, _encoding, callback) {
							size += chunk.length;
							if (size > file.size)
								return callback(new Error("Archive entry exceeds signed size"));
							hash.update(chunk);
							callback(null, chunk);
						},
					});
					await pipeline(
						entry,
						digest,
						createWriteStream(path, { flags: "wx", mode: file.mode }),
					);
					if (size !== file.size || hash.digest("hex") !== file.sha256)
						throw new Error("Archive entry digest mismatch");
					completed += size;
					verifiedFiles++;
					if (
						performance.now() - lastProgress >= 200 ||
						verifiedFiles === expected.size
					) {
						lastProgress = performance.now();
						onProgress?.(completed, verifiedFiles);
					}
				})();
				writes.add(write);
				void write.then(
					() => writes.delete(write),
					(error) => {
						failure = error;
						writes.delete(write);
						parser.abort(error);
					},
				);
			} catch (error) {
				failure =
					error instanceof Error ? error : new Error("Invalid release archive");
				parser.abort(failure);
			}
		},
	});
	const limit = new Transform({
		transform(chunk: Buffer, _encoding, callback) {
			expanded += chunk.length;
			if (expanded > archive.unpackedBytes + archive.entryCount * 9728 + 1024)
				return callback(new Error("Archive exceeds signed expansion budget"));
			callback(null, chunk);
		},
	});
	try {
		await pipeline(
			createReadStream(snapshot),
			archiveDigest,
			createGunzip(),
			limit,
			parser,
		);
		await Promise.all(writes);
		if (failure) throw failure;
		if (
			archiveBytes !== archive.size ||
			archiveHash.digest("hex") !== archive.sha256
		)
			throw new Error("Release archive digest mismatch");
		if (seen.size !== expected.size || completed !== archive.unpackedBytes)
			throw new Error("Release archive is incomplete");
	} catch (error) {
		parser.abort(
			error instanceof Error ? error : new Error("Release archive failed"),
		);
		await Promise.allSettled(writes);
		throw error;
	}
}

import { afterEach, expect, test } from "bun:test";
import { createHash, sign } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import { create } from "tar";
import { createReleaseArchive, extractReleaseArchive } from "./archive";
import { verifyReleaseArchiveAsync, verifyReleaseManifest } from "./release";
import { createSignedReleaseFixture } from "./release-fixture";

const roots: string[] = [];
afterEach(() => {
	for (const root of roots.splice(0))
		rmSync(root, { recursive: true, force: true });
});
function temporary() {
	const root = mkdtempSync(join(tmpdir(), "archive-test-"));
	roots.push(root);
	return root;
}
async function fixture(
	duplicate = false,
	mutate?: (tar: Buffer) => Buffer,
	empty = false,
	large = false,
) {
	const f = createSignedReleaseFixture();
	roots.push(f.root);
	if (empty || large) {
		const first = f.manifest.files[0];
		if (!first) throw new Error("No fixture entry");
		const bytes = large ? Buffer.alloc(2 * 1024 * 1024, 67) : Buffer.alloc(0);
		writeFileSync(join(f.root, first.path), bytes);
		first.size = bytes.length;
		first.sha256 = createHash("sha256").update(bytes).digest("hex");
	}
	const packed = temporary();
	const path = join(packed, "backend.tar.gz");
	if (duplicate)
		await create(
			{ cwd: f.root, file: path, gzip: true, portable: true, noMtime: true },
			[...f.manifest.files.map((file) => file.path), "lib/node"],
		);
	else await createReleaseArchive(f.root, path, f.manifest.files, 6);
	if (mutate)
		writeFileSync(path, gzipSync(mutate(gunzipSync(readFileSync(path)))));
	const bytes = readFileSync(path);
	const manifest = {
		...f.manifest,
		formatVersion: 2,
		archive: {
			path: "backend.tar.gz",
			compression: "gzip",
			size: bytes.length,
			sha256: createHash("sha256").update(bytes).digest("hex"),
			unpackedBytes: f.manifest.files.reduce((sum, file) => sum + file.size, 0),
			entryCount: f.manifest.files.length,
		},
	};
	const manifestBytes = Buffer.from(JSON.stringify(manifest));
	const signature = Buffer.from(
		JSON.stringify({
			keyId: "release",
			signature: sign(null, manifestBytes, f.pair.privateKey).toString(
				"base64",
			),
		}),
	);
	writeFileSync(join(packed, "release-manifest.json"), manifestBytes);
	writeFileSync(join(packed, "release-signature.json"), signature);
	return {
		...f,
		packed,
		path,
		verified: verifyReleaseManifest(manifestBytes, signature, f.keys),
	};
}
test.each([
	1, 4, 8,
])("V2 verifies all signed files with a writer bound of %s", async (concurrency) => {
	const f = await fixture();
	const verified = await verifyReleaseArchiveAsync(f.packed, f.keys);
	const destination = temporary();
	await extractReleaseArchive(
		f.path,
		destination,
		verified,
		undefined,
		concurrency,
	);
	for (const file of f.manifest.files)
		expect(readFileSync(join(destination, file.path))).toEqual(
			readFileSync(join(f.root, file.path)),
		);
});
test("a signed archive with a duplicate entry cannot publish a candidate", async () => {
	const f = await fixture(true);
	await expect(
		extractReleaseArchive(f.path, temporary(), f.verified),
	).rejects.toThrow("Unexpected archive entry");
});

test("empty signed files do not stall sequential extraction", async () => {
	const f = await fixture(false, undefined, true);
	const destination = temporary();
	await extractReleaseArchive(f.path, destination, f.verified);
	expect(readFileSync(join(destination, "lib/node")).length).toBe(0);
});

test("entries larger than stream buffers preserve backpressure and finish extraction", async () => {
	const f = await fixture(false, undefined, false, true);
	const destination = temporary();
	await extractReleaseArchive(f.path, destination, f.verified);
	expect(readFileSync(join(destination, "lib/node")).length).toBe(
		2 * 1024 * 1024,
	);
});
test("archive mutation fails verification before bootstrap execution", async () => {
	const f = await fixture();
	const bytes = readFileSync(f.path);
	bytes[bytes.length - 1] = (bytes[bytes.length - 1] ?? 0) ^ 1;
	writeFileSync(f.path, bytes);
	await expect(verifyReleaseArchiveAsync(f.packed, f.keys)).rejects.toThrow(
		"digest mismatch",
	);
});

test.each([
	"symlink",
	"hardlink",
	"fifo",
	"traversal",
	"unlisted",
])("a signed archive rejects unsafe entry: %s", async (kind) => {
	const f = await fixture(false, (tar) => {
		if (["symlink", "hardlink", "fifo"].includes(kind))
			tar[156] = kind === "symlink" ? 50 : kind === "hardlink" ? 49 : 54;
		else {
			tar.fill(0, 0, 100);
			tar.write(kind === "traversal" ? "../outside" : "unexpected", 0, "utf8");
		}
		tar.fill(32, 148, 156);
		const sum = tar.subarray(0, 512).reduce((total, byte) => total + byte, 0);
		tar.write(`${sum.toString(8).padStart(6, "0")}\0 `, 148, "ascii");
		return tar;
	});
	await expect(
		extractReleaseArchive(f.path, temporary(), f.verified),
	).rejects.toThrow();
});

test("streamed file content must match its own signed digest even when archive digest is valid", async () => {
	const f = await fixture(false, (tar) => {
		tar[512] = (tar[512] ?? 0) ^ 1;
		return tar;
	});
	await expect(
		extractReleaseArchive(f.path, temporary(), f.verified),
	).rejects.toThrow("entry digest mismatch");
});

test("a signed gzip cannot expand beyond its bounded file and header budget", async () => {
	const f = await fixture(false, (tar) =>
		Buffer.concat([tar, Buffer.alloc(1024 * 1024)]),
	);
	await expect(
		extractReleaseArchive(f.path, temporary(), f.verified),
	).rejects.toThrow("expansion budget");
});

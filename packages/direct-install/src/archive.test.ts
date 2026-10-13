import { afterEach, expect, test } from "bun:test";
import { createHash, sign } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
async function fixture(duplicate = false) {
	const f = createSignedReleaseFixture();
	roots.push(f.root);
	const packed = temporary();
	const path = join(packed, "backend.tar.gz");
	if (duplicate)
		await create(
			{ cwd: f.root, file: path, gzip: true, portable: true, noMtime: true },
			[...f.manifest.files.map((file) => file.path), "lib/node"],
		);
	else await createReleaseArchive(f.root, path, f.manifest.files, 6);
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
test("V2 verifies the archive asynchronously and writes every signed file with bounded streaming", async () => {
	const f = await fixture();
	const verified = await verifyReleaseArchiveAsync(f.packed, f.keys);
	const destination = temporary();
	await extractReleaseArchive(f.path, destination, verified);
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
test("archive mutation fails verification before bootstrap execution", async () => {
	const f = await fixture();
	const bytes = readFileSync(f.path);
	bytes[bytes.length - 1] = (bytes[bytes.length - 1] ?? 0) ^ 1;
	writeFileSync(f.path, bytes);
	await expect(verifyReleaseArchiveAsync(f.packed, f.keys)).rejects.toThrow(
		"digest mismatch",
	);
});

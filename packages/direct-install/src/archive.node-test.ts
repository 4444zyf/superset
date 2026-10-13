import assert from "node:assert/strict";
import { createHash, sign } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createReleaseArchive, extractReleaseArchive } from "./archive.ts";
import { verifyReleaseManifest } from "./release.ts";
import { createSignedReleaseFixture } from "./release-fixture.ts";

test("the shipped Node stream implementation extracts large and empty signed entries", async () => {
	const f = createSignedReleaseFixture();
	const work = mkdtempSync(join(tmpdir(), "archive-node-"));
	try {
		for (const [index, bytes] of [
			Buffer.alloc(2 * 1024 * 1024, 67),
			Buffer.alloc(0),
		].entries()) {
			const file = f.manifest.files[index];
			assert.ok(file);
			writeFileSync(join(f.root, file.path), bytes);
			file.size = bytes.length;
			file.sha256 = createHash("sha256").update(bytes).digest("hex");
		}
		const path = join(work, "backend.tar.gz");
		await createReleaseArchive(f.root, path, f.manifest.files, 6);
		const packed = readFileSync(path);
		const manifest = Buffer.from(
			JSON.stringify({
				...f.manifest,
				formatVersion: 2,
				archive: {
					path: "backend.tar.gz",
					compression: "gzip",
					size: packed.length,
					sha256: createHash("sha256").update(packed).digest("hex"),
					unpackedBytes: f.manifest.files.reduce(
						(total, file) => total + file.size,
						0,
					),
					entryCount: f.manifest.files.length,
				},
			}),
		);
		const signature = Buffer.from(
			JSON.stringify({
				keyId: "release",
				signature: sign(null, manifest, f.pair.privateKey).toString("base64"),
			}),
		);
		const verified = verifyReleaseManifest(manifest, signature, f.keys);
		await extractReleaseArchive(path, join(work, "payload"), verified);
		assert.equal(
			readFileSync(join(work, "payload/lib/node")).length,
			2 * 1024 * 1024,
		);
		assert.equal(
			readFileSync(join(work, "payload/lib/host-service-direct.js")).length,
			0,
		);
	} finally {
		rmSync(f.root, { recursive: true, force: true });
		rmSync(work, { recursive: true, force: true });
	}
});

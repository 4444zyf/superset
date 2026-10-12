import { expect, test } from "bun:test";
import { createPublicKey, sign, verify } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { prepareDirectPreviewSigning } from "./prepare-direct-preview-signing";

test("preview trust contains only the matching public key while its ephemeral private key stays in a private file", () => {
	const root = mkdtempSync(join(tmpdir(), "direct-preview-key-"));
	const privateKeyPath = join(root, "private.pem");
	const publicKeysPath = join(root, "public.json");
	try {
		const keys = prepareDirectPreviewSigning({
			keyId: "preview-darwin-arm64",
			privateKeyPath,
			publicKeysPath,
		});
		const privateKey = readFileSync(privateKeyPath, "utf8");
		expect(statSync(privateKeyPath).mode & 0o777).toBe(0o600);
		expect(JSON.parse(readFileSync(publicKeysPath, "utf8"))).toEqual(keys);
		expect(keys["preview-darwin-arm64"]).toBe(
			createPublicKey(privateKey)
				.export({ format: "pem", type: "spki" })
				.toString(),
		);
		const bytes = Buffer.from("sealed preview manifest");
		expect(
			verify(
				null,
				bytes,
				keys["preview-darwin-arm64"]!,
				sign(null, bytes, privateKey),
			),
		).toBe(true);
		expect(JSON.stringify(keys)).not.toContain("PRIVATE KEY");
		expect(() =>
			prepareDirectPreviewSigning({
				keyId: "production",
				privateKeyPath,
				publicKeysPath,
			}),
		).toThrow("preview key ID");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

import { afterEach, expect, test } from "bun:test";
import { generateKeyPairSync, verify } from "node:crypto";
import {
	chmodSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	listReleaseFiles,
	resolveDirectRuntime,
	signRelease,
	smokeHostImport,
} from "./build-direct";

const roots: string[] = [];
const root = () => {
	const result = mkdtempSync(join(tmpdir(), "direct-build-"));
	roots.push(result);
	return result;
};
afterEach(() => {
	for (const directory of roots.splice(0))
		rmSync(directory, { recursive: true, force: true });
});
test("release import smoke does not execute the emitted host CLI main guard", async () => {
	const directory = root();
	const entry = join(directory, "host-service-direct.mjs");
	writeFileSync(
		entry,
		"import {pathToFileURL} from 'node:url';import {resolve} from 'node:path';if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)throw new Error('host CLI executed during import smoke');export const ready=true;",
	);
	const node = Bun.which("node");
	if (!node)
		throw new Error("Node is required by the direct release build tests");
	await smokeHostImport(node, entry);
});
test("signs exact manifest bytes with the release key and records digests and executable modes", () => {
	const directory = root();
	writeFileSync(join(directory, "worker.js"), "worker");
	writeFileSync(join(directory, "node"), "node");
	chmodSync(join(directory, "node"), 0o755);
	const keys = generateKeyPairSync("ed25519");
	signRelease(
		directory,
		{
			version: "1.0.0",
			target: "darwin-arm64",
			protocolVersion: 1,
			schemaVersion: 1,
			minimumMacOS: "12.0",
			nodeVersion: "24.15.0",
			nodeAbi: 137,
		},
		"release",
		keys.privateKey.export({ format: "pem", type: "pkcs8" }).toString(),
	);
	const bytes = readFileSync(join(directory, "release-manifest.json"));
	const signature = JSON.parse(
		readFileSync(join(directory, "release-signature.json"), "utf8"),
	);
	expect(
		verify(
			null,
			bytes,
			keys.publicKey,
			Buffer.from(signature.signature, "base64"),
		),
	).toBe(true);
	expect(
		JSON.parse(bytes.toString()).files.find(
			(file: { path: string }) => file.path === "node",
		).mode,
	).toBe(0o755);
});
test("refuses to package symlinks into a signed privileged release", () => {
	const directory = root();
	symlinkSync("/etc/passwd", join(directory, "escape"));
	expect(() => listReleaseFiles(directory)).toThrow("symlink");
});
test("rejects mismatched Node ABI and a lower macOS floor before building", () => {
	expect(() => resolveDirectRuntime("22.23.3", 137)).toThrow("ABI");
	expect(() => resolveDirectRuntime("24.21.0", 137, "12.0")).toThrow("macOS");
	expect(resolveDirectRuntime("24.21.0", 137).minimumMacOS).toBe("13.5");
});

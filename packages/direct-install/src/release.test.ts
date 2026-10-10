import { afterEach, describe, expect, test } from "bun:test";
import { sign } from "node:crypto";
import { rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { verifyReleaseBundle } from "./release";
import { createSignedReleaseFixture } from "./release-fixture";

const roots: string[] = [];
afterEach(() => {
	for (const root of roots.splice(0))
		rmSync(root, { recursive: true, force: true });
});

function fixture() {
	const f = createSignedReleaseFixture();
	roots.push(f.root);
	return f;
}

describe("trusted direct releases", () => {
	test("verifies the complete signed macOS release", () => {
		const f = fixture();
		expect(verifyReleaseBundle(f.root, f.keys).manifest.target).toBe(
			"darwin-arm64",
		);
	});
	test("rejects a key supplied by the selected release itself", () => {
		const f = fixture();
		expect(() => verifyReleaseBundle(f.root, {})).toThrow("trusted");
	});
	test("rejects a signed release missing the dynamically loaded headless terminal", () => {
		const f = fixture();
		const missing =
			"lib/node_modules/@xterm/headless/lib-headless/xterm-headless.js";
		f.manifest.files = f.manifest.files.filter((file) => file.path !== missing);
		rmSync(join(f.root, missing), { force: true });
		const bytes = Buffer.from(JSON.stringify(f.manifest));
		writeFileSync(join(f.root, "release-manifest.json"), bytes);
		writeFileSync(
			join(f.root, "release-signature.json"),
			JSON.stringify({
				keyId: "release",
				signature: sign(null, bytes, f.pair.privateKey).toString("base64"),
			}),
		);
		expect(() => verifyReleaseBundle(f.root, f.keys)).toThrow("Incomplete");
	});
	test("rejects a signed release missing a required native binding", () => {
		const f = fixture();
		const missing =
			"lib/node_modules/better-sqlite3/build/Release/better_sqlite3.node";
		f.manifest.files = f.manifest.files.filter((file) => file.path !== missing);
		rmSync(join(f.root, missing));
		const bytes = Buffer.from(JSON.stringify(f.manifest));
		writeFileSync(join(f.root, "release-manifest.json"), bytes);
		writeFileSync(
			join(f.root, "release-signature.json"),
			JSON.stringify({
				keyId: "release",
				signature: sign(null, bytes, f.pair.privateKey).toString("base64"),
			}),
		);
		expect(() => verifyReleaseBundle(f.root, f.keys)).toThrow("Incomplete");
	});
	test("rejects payload mutation after signing", () => {
		const f = fixture();
		writeFileSync(join(f.root, "lib/host-worker.js"), "corrupt");
		expect(() => verifyReleaseBundle(f.root, f.keys)).toThrow("digest");
	});
	test("rejects symlink payloads even when bytes match", () => {
		const f = fixture();
		rmSync(join(f.root, "lib/host-worker.js"));
		symlinkSync(
			join(f.root, "lib/pty-daemon.js"),
			join(f.root, "lib/host-worker.js"),
		);
		expect(() => verifyReleaseBundle(f.root, f.keys)).toThrow("regular");
	});
	test("rejects signed traversal paths", () => {
		const f = fixture();
		const first = f.manifest.files[0];
		if (!first) throw new Error("Missing fixture file");
		first.path = "../outside";
		const bytes = Buffer.from(JSON.stringify(f.manifest));
		writeFileSync(join(f.root, "release-manifest.json"), bytes);
		writeFileSync(
			join(f.root, "release-signature.json"),
			JSON.stringify({
				keyId: "release",
				signature: sign(null, bytes, f.pair.privateKey).toString("base64"),
			}),
		);
		expect(() => verifyReleaseBundle(f.root, f.keys)).toThrow("path");
	});
	test("rejects unlisted payload files", () => {
		const f = fixture();
		writeFileSync(join(f.root, "lib/extra.js"), "unexpected");
		expect(() => verifyReleaseBundle(f.root, f.keys)).toThrow("unlisted");
	});
});

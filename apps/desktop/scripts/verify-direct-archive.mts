import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { extractReleaseArchive } from "../../../packages/direct-install/src/archive";
import { verifyReleaseBundle } from "../../../packages/direct-install/src/release";

const resources = resolve(process.argv[2] ?? "");
const root = join(resources, "direct-backend", `darwin-${process.arch}`);
const keys = JSON.parse(
	readFileSync(join(resources, "direct-release-keys.json"), "utf8"),
);
const release = verifyReleaseBundle(root, keys);
const temporary = mkdtempSync(join(tmpdir(), "verified-direct-archive-"));
try {
	let expanded = root;
	if (release.manifest.archive) {
		expanded = temporary;
		await extractReleaseArchive(
			join(root, release.manifest.archive.path),
			expanded,
			release,
		);
	}
	execFileSync(
		join(expanded, "lib/node"),
		[join(expanded, "lib/direct-installer.js"), "--smoke-user", "e30="],
		{ stdio: "inherit" },
	);
	execFileSync(
		join(expanded, "lib/node"),
		[
			"--input-type=module",
			"-e",
			"await import(process.argv[2])",
			"direct-import-smoke",
			join(expanded, "lib/host-service-direct.js"),
		],
		{ stdio: "inherit" },
	);
	assert.equal(release.manifest.target, `darwin-${process.arch}`);
} finally {
	rmSync(temporary, { recursive: true, force: true });
}

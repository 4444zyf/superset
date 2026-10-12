import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { verifyDirectPackaging } from "./verify-direct-resources";

test("the signed preview guard rejects a missing trust configuration even with the development flag set", () => {
	const result = spawnSync(
		process.execPath,
		[
			resolve(import.meta.dirname, "verify-direct-resources.ts"),
			"--require-signed",
		],
		{
			env: {
				...process.env,
				DIRECT_RELEASE_PUBLIC_KEYS_JSON: "",
				SUPERSET_DIRECT_DEVELOPMENT_PACKAGE: "1",
			},
			encoding: "utf8",
		},
	);
	expect(result.status).toBe(1);
	expect(result.stderr).toContain("requires DIRECT_RELEASE_PUBLIC_KEYS_JSON");
});

test("explicit unsigned development packaging cannot carry stale embedded backend trust or payload", () => {
	const root = mkdtempSync(join(tmpdir(), "direct-development-package-"));
	const options = {
		resourcesDir: root,
		expectedVersion: "1.0.0",
		developmentPackage: true,
	};
	try {
		expect(verifyDirectPackaging(options)).toBe("development");
		writeFileSync(join(root, "direct-release-keys.json"), "{}");
		expect(() => verifyDirectPackaging(options)).toThrow("stale");
		rmSync(join(root, "direct-release-keys.json"));
		mkdirSync(join(root, "direct-backend"));
		expect(() => verifyDirectPackaging(options)).toThrow("stale");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("a normal package fails without independent signing configuration and a development flag cannot bypass configured pins", () => {
	const root = mkdtempSync(join(tmpdir(), "direct-required-package-"));
	try {
		expect(() =>
			verifyDirectPackaging({ resourcesDir: root, expectedVersion: "1.0.0" }),
		).toThrow("DIRECT_RELEASE_PUBLIC_KEYS_JSON");
		expect(() =>
			verifyDirectPackaging({
				resourcesDir: root,
				expectedVersion: "1.0.0",
				developmentPackage: true,
				keysJson: "{}",
			}),
		).toThrow("public");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

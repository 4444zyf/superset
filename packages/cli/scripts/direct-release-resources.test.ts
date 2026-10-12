import { afterEach, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { generateKeyPairSync, type KeyObject, sign } from "node:crypto";
import {
	chmodSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	renameSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
	type ReleaseManifest,
	type TrustedReleaseKeys,
	verifyReleaseBundle,
} from "@superset/direct-install";
import {
	parseDirectReleaseKeys,
	stageDirectResources,
	validateDirectSigningIdentity,
	verifyDirectResources,
} from "./direct-release-resources";

const { createSignedReleaseFixture } = (await import(
	pathToFileURL(
		resolve(import.meta.dir, "../../direct-install/src/release-fixture.ts"),
	).href
)) as {
	createSignedReleaseFixture: () => {
		root: string;
		manifest: ReleaseManifest;
		pair: { privateKey: KeyObject; publicKey: KeyObject };
		keys: TrustedReleaseKeys;
	};
};

const roots: string[] = [];
function fixture() {
	const arm = createSignedReleaseFixture();
	const x64 = createSignedReleaseFixture();
	const resourcesDir = mkdtempSync(join(tmpdir(), "direct-resources-"));
	roots.push(arm.root, x64.root, resourcesDir);
	x64.manifest.target = "darwin-x64";
	for (const file of x64.manifest.files) {
		if (!file.path.includes("darwin-arm64")) continue;
		const previous = join(x64.root, file.path);
		file.path = file.path.replaceAll("darwin-arm64", "darwin-x64");
		const next = join(x64.root, file.path);
		mkdirSync(join(next, ".."), { recursive: true });
		renameSync(previous, next);
	}
	const bytes = Buffer.from(JSON.stringify(x64.manifest));
	writeFileSync(join(x64.root, "release-manifest.json"), bytes);
	writeFileSync(
		join(x64.root, "release-signature.json"),
		JSON.stringify({
			keyId: "release",
			signature: sign(null, bytes, arm.pair.privateKey).toString("base64"),
		}),
	);
	const options = {
		releaseRoots: { "darwin-arm64": arm.root, "darwin-x64": x64.root },
		trustedKeys: arm.keys,
		resourcesDir,
		expectedVersion: "1.0.0",
	};
	return { arm, x64, options };
}
afterEach(() => {
	for (const root of roots.splice(0))
		rmSync(root, { recursive: true, force: true });
});

test("stages independently trusted complete dual-architecture releases and restores artifact executable modes", () => {
	const f = fixture();
	chmodSync(join(f.arm.root, "lib/node"), 0o644);
	stageDirectResources(f.options);
	const keys = JSON.parse(
		readFileSync(
			join(f.options.resourcesDir, "direct-release-keys.json"),
			"utf8",
		),
	);
	expect(keys).toEqual(f.arm.keys);
	for (const target of ["darwin-arm64", "darwin-x64"] as const) {
		const root = join(f.options.resourcesDir, "direct-backend", target);
		expect(verifyReleaseBundle(root, keys).manifest.target).toBe(target);
		expect(statSync(join(root, "lib/node")).mode & 0o777).toBe(0o755);
	}
	verifyDirectResources(f.options);
});

test("missing, mutated or wrong-architecture artifacts cannot replace an existing packaged resource", () => {
	const f = fixture();
	stageDirectResources(f.options);
	const previous = readFileSync(
		join(f.options.resourcesDir, "direct-backend/darwin-arm64/lib/node"),
	);
	writeFileSync(join(f.arm.root, "lib/node"), "mutated");
	expect(() => stageDirectResources(f.options)).toThrow("digest");
	expect(
		readFileSync(
			join(f.options.resourcesDir, "direct-backend/darwin-arm64/lib/node"),
		),
	).toEqual(previous);
	expect(() =>
		stageDirectResources({
			...f.options,
			releaseRoots: { ...f.options.releaseRoots, "darwin-x64": f.arm.root },
		}),
	).toThrow();
	rmSync(join(f.x64.root, "release-signature.json"));
	expect(() => stageDirectResources(f.options)).toThrow();
});

test("packaging fails closed when the expected backend version or complete signed resources are missing", () => {
	const f = fixture();
	expect(() => verifyDirectResources(f.options)).toThrow();
	expect(() =>
		stageDirectResources({ ...f.options, expectedVersion: "2.0.0" }),
	).toThrow("version");
	expect(
		existsSync(join(f.options.resourcesDir, "direct-release-keys.json")),
	).toBe(false);
});

test("the release CLI assembles downloaded artifact directories and verifies the emitted private resource directory", () => {
	const f = fixture();
	const version = JSON.parse(
		readFileSync(resolve(import.meta.dir, "../package.json"), "utf8"),
	).version as string;
	for (const release of [f.arm, f.x64]) {
		release.manifest.version = version;
		const bytes = Buffer.from(JSON.stringify(release.manifest));
		writeFileSync(join(release.root, "release-manifest.json"), bytes);
		writeFileSync(
			join(release.root, "release-signature.json"),
			JSON.stringify({
				keyId: "release",
				signature: sign(null, bytes, f.arm.pair.privateKey).toString("base64"),
			}),
		);
	}
	const input = join(f.options.resourcesDir, "artifacts");
	mkdirSync(input);
	renameSync(f.arm.root, join(input, "darwin-arm64"));
	renameSync(f.x64.root, join(input, "darwin-x64"));
	const output = join(f.options.resourcesDir, "assembled");
	const script = resolve(import.meta.dir, "stage-direct-resources.ts");
	const env = {
		PATH: process.env.PATH,
		HOME: f.options.resourcesDir,
		DIRECT_RELEASE_PUBLIC_KEYS_JSON: JSON.stringify(f.arm.keys),
	};
	const staged = spawnSync(
		process.execPath,
		[script, `--input-dir=${input}`, `--resources-dir=${output}`],
		{ env, encoding: "utf8", timeout: 1000 },
	);
	expect(staged.status).toBe(0);
	const verified = spawnSync(
		process.execPath,
		[script, "--verify", `--resources-dir=${output}`],
		{ env, encoding: "utf8", timeout: 1000 },
	);
	expect(verified.status).toBe(0);
	expect(
		readFileSync(join(output, "direct-backend/darwin-x64/lib/node"), "utf8"),
	).toBe("lib/node");
});

test("the signing key must match a separately pinned Ed25519 public key and private keys cannot be embedded", () => {
	const f = fixture();
	const pem = f.arm.pair.privateKey
		.export({ type: "pkcs8", format: "pem" })
		.toString();
	expect(parseDirectReleaseKeys(f.arm.keys)).toEqual(f.arm.keys);
	validateDirectSigningIdentity(pem, "release", f.arm.keys);
	const other = generateKeyPairSync("ed25519");
	expect(() =>
		validateDirectSigningIdentity(
			other.privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
			"release",
			f.arm.keys,
		),
	).toThrow("pinned");
	expect(() => parseDirectReleaseKeys({ release: pem })).toThrow("public");
	expect(() =>
		parseDirectReleaseKeys({
			release: `${f.arm.keys.release}${pem}-----END PUBLIC KEY-----\n`,
		}),
	).toThrow("public");
	expect(() => parseDirectReleaseKeys({})).toThrow("public");
});

import { createPrivateKey, createPublicKey } from "node:crypto";
import {
	chmodSync,
	copyFileSync,
	existsSync,
	lstatSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	renameSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import {
	type TrustedReleaseKeys,
	type VerifiedRelease,
	verifyReleaseBundle,
} from "@superset/direct-install";

export function parseDirectReleaseKeys(input: unknown): TrustedReleaseKeys {
	if (!input || typeof input !== "object" || Array.isArray(input))
		throw new Error("A nonempty pinned public key map is required");
	const result: Record<string, string> = Object.create(null);
	for (const [id, pem] of Object.entries(input).sort(([a], [b]) =>
		a.localeCompare(b),
	)) {
		if (
			!/^[a-zA-Z0-9._-]{1,128}$/.test(id) ||
			typeof pem !== "string" ||
			pem.length > 8192 ||
			!/^-----BEGIN PUBLIC KEY-----\r?\n[A-Za-z0-9+/=\r\n]+-----END PUBLIC KEY-----\s*$/.test(
				pem,
			)
		)
			throw new Error(
				"Release trust configuration must contain only public keys",
			);
		const key = createPublicKey(pem);
		if (key.asymmetricKeyType !== "ed25519")
			throw new Error("Release public keys must use Ed25519");
		result[id] = key.export({ format: "pem", type: "spki" }).toString();
	}
	if (Object.keys(result).length < 1 || Object.keys(result).length > 16)
		throw new Error("A bounded nonempty pinned public key map is required");
	return result;
}

export function validateDirectSigningIdentity(
	privateKeyPem: string,
	keyId: string,
	trustedKeys: TrustedReleaseKeys,
): void {
	const pinned = parseDirectReleaseKeys(trustedKeys);
	if (!Object.hasOwn(pinned, keyId))
		throw new Error(
			"The signing identity is absent from the pinned public keys",
		);
	const key = createPrivateKey(privateKeyPem);
	if (
		key.asymmetricKeyType !== "ed25519" ||
		!createPublicKey(key)
			.export({ format: "der", type: "spki" })
			.equals(
				createPublicKey(pinned[keyId] as string).export({
					format: "der",
					type: "spki",
				}),
			)
	)
		throw new Error("The signing identity differs from the pinned public key");
}

interface DirectResourcesOptions {
	releaseRoots: { "darwin-arm64": string; "darwin-x64": string };
	trustedKeys: TrustedReleaseKeys;
	resourcesDir: string;
	expectedVersion: string;
}

const targets = ["darwin-arm64", "darwin-x64"] as const;
function verifyPair(
	options: Omit<DirectResourcesOptions, "resourcesDir">,
): VerifiedRelease[] {
	const releases = targets.map((target) => {
		const release = verifyReleaseBundle(
			options.releaseRoots[target],
			options.trustedKeys,
		);
		if (release.manifest.target !== target)
			throw new Error(
				"The backend release architecture differs from its resource target",
			);
		if (release.manifest.version !== options.expectedVersion)
			throw new Error(
				"The backend release version differs from the packaged source version",
			);
		return release;
	});
	const [arm, x64] = releases as [VerifiedRelease, VerifiedRelease];
	for (const field of [
		"protocolVersion",
		"schemaVersion",
		"nodeVersion",
		"nodeAbi",
	] as const) {
		if (arm.manifest[field] !== x64.manifest[field])
			throw new Error(
				"The two backend releases have incompatible runtime metadata",
			);
	}
	const migrations = (release: VerifiedRelease) =>
		JSON.stringify(
			release.manifest.files
				.filter(
					(file) =>
						file.path.startsWith("share/migrations/") ||
						file.path.startsWith("lib/chat-migrations/"),
				)
				.map((file) => [file.path, file.size, file.sha256])
				.sort(([a], [b]) => String(a).localeCompare(String(b))),
		);
	if (migrations(arm) !== migrations(x64))
		throw new Error("The two backend releases have different migrations");
	return releases;
}

export function stageDirectResources(options: DirectResourcesOptions): void {
	const trustedKeys = parseDirectReleaseKeys(options.trustedKeys);
	const releases = verifyPair({ ...options, trustedKeys });
	mkdirSync(options.resourcesDir, { recursive: true });
	const work = mkdtempSync(
		join(options.resourcesDir, ".direct-release-stage-"),
	);
	const destination = join(options.resourcesDir, "direct-backend");
	const keyPath = join(options.resourcesDir, "direct-release-keys.json");
	let previousBackend = false;
	let previousKeys = false;
	let newBackend = false;
	let newKeys = false;
	try {
		for (const [index, target] of targets.entries()) {
			const release = releases[index] as VerifiedRelease;
			const output = join(work, "direct-backend", target);
			for (const file of [
				...(release.manifest.archive
					? [{ path: release.manifest.archive.path, mode: 0o644 }]
					: release.manifest.files),
				{ path: "release-manifest.json", mode: 0o644 },
				{ path: "release-signature.json", mode: 0o644 },
			]) {
				mkdirSync(join(output, file.path, ".."), { recursive: true });
				copyFileSync(
					join(options.releaseRoots[target], file.path),
					join(output, file.path),
				);
				chmodSync(join(output, file.path), file.mode);
			}
		}
		writeFileSync(
			join(work, "direct-release-keys.json"),
			JSON.stringify(trustedKeys),
			{ flag: "wx", mode: 0o644 },
		);
		verifyDirectResources({ ...options, trustedKeys, resourcesDir: work });
		if (existsSync(destination)) {
			if (
				!lstatSync(destination).isDirectory() ||
				lstatSync(destination).isSymbolicLink()
			)
				throw new Error(
					"The existing backend resource must be a regular directory",
				);
			renameSync(destination, join(work, "previous-backend"));
			previousBackend = true;
		}
		if (existsSync(keyPath)) {
			if (!lstatSync(keyPath).isFile() || lstatSync(keyPath).isSymbolicLink())
				throw new Error(
					"The existing public key resource must be a regular file",
				);
			renameSync(keyPath, join(work, "previous-keys.json"));
			previousKeys = true;
		}
		renameSync(join(work, "direct-backend"), destination);
		newBackend = true;
		renameSync(join(work, "direct-release-keys.json"), keyPath);
		newKeys = true;
	} catch (error) {
		if (newBackend) rmSync(destination, { recursive: true, force: true });
		if (newKeys) rmSync(keyPath, { force: true });
		if (previousBackend)
			renameSync(join(work, "previous-backend"), destination);
		if (previousKeys) renameSync(join(work, "previous-keys.json"), keyPath);
		throw error;
	} finally {
		rmSync(work, { recursive: true, force: true });
	}
}

export function verifyDirectResources(options: {
	resourcesDir: string;
	expectedVersion: string;
	trustedKeys: TrustedReleaseKeys;
}): void {
	const trustedKeys = parseDirectReleaseKeys(options.trustedKeys);
	const embedded = parseDirectReleaseKeys(
		JSON.parse(
			readFileSync(
				join(options.resourcesDir, "direct-release-keys.json"),
				"utf8",
			),
		),
	);
	if (JSON.stringify(embedded) !== JSON.stringify(trustedKeys))
		throw new Error(
			"Embedded public keys differ from the independent pinned release configuration",
		);
	const releases = verifyPair({
		...options,
		trustedKeys,
		releaseRoots: {
			"darwin-arm64": join(options.resourcesDir, "direct-backend/darwin-arm64"),
			"darwin-x64": join(options.resourcesDir, "direct-backend/darwin-x64"),
		},
	});
	for (const [index, target] of targets.entries()) {
		if (releases[index]?.manifest.archive) continue;
		for (const file of (releases[index] as VerifiedRelease).manifest.files) {
			if (
				(lstatSync(
					join(options.resourcesDir, "direct-backend", target, file.path),
				).mode &
					0o777) !==
				file.mode
			)
				throw new Error(
					"The packaged backend executable modes differ from the signed manifest",
				);
		}
	}
}

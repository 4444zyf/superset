import { createHash, createPublicKey, verify } from "node:crypto";
import {
	closeSync,
	existsSync,
	lstatSync,
	openSync,
	readdirSync,
	readFileSync,
	readSync,
	realpathSync,
} from "node:fs";
import { open } from "node:fs/promises";
import { join, posix } from "node:path";

export interface ReleaseFile {
	path: string;
	sha256: string;
	size: number;
	mode: number;
}
export interface ReleaseManifest {
	formatVersion: 1 | 2;
	archive?: {
		path: "backend.tar.gz";
		compression: "gzip";
		size: number;
		sha256: string;
		unpackedBytes: number;
		entryCount: number;
	};
	version: string;
	target: "darwin-arm64" | "darwin-x64";
	protocolVersion: number;
	schemaVersion: number;
	minimumMacOS: string;
	nodeVersion: string;
	nodeAbi: number;
	files: ReleaseFile[];
}
export type TrustedReleaseKeys = Readonly<Record<string, string>>;
export interface VerifiedRelease {
	manifest: ReleaseManifest;
	manifestBytes: Buffer;
	releaseId: string;
	signatureBytes: Buffer;
}

export const hasControlCharacters = (value: string): boolean =>
	Array.from(value).some(
		(character) =>
			character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
	);

export function safeReleasePath(path: string): void {
	if (
		!path ||
		path.includes("\\") ||
		hasControlCharacters(path) ||
		posix.isAbsolute(path) ||
		posix.normalize(path) !== path ||
		path.split("/").some((part) => !part || part === "." || part === "..")
	) {
		throw new Error(`Invalid release path: ${path}`);
	}
}

export function verifyReleaseManifest(
	manifestBytes: Buffer,
	signatureBytes: Buffer,
	trustedKeys: TrustedReleaseKeys,
): VerifiedRelease {
	if (manifestBytes.length > 16 * 1024 * 1024 || signatureBytes.length > 8192)
		throw new Error("Release manifest is too large");
	const signature = JSON.parse(signatureBytes.toString("utf8")) as {
		keyId?: unknown;
		signature?: unknown;
	};
	if (
		typeof signature.keyId !== "string" ||
		!Object.hasOwn(trustedKeys, signature.keyId)
	)
		throw new Error("Release signer is not trusted");
	const publicKey = createPublicKey(trustedKeys[signature.keyId] as string);
	if (
		publicKey.asymmetricKeyType !== "ed25519" ||
		typeof signature.signature !== "string" ||
		!verify(
			null,
			manifestBytes,
			publicKey,
			Buffer.from(signature.signature, "base64"),
		)
	)
		throw new Error("Release signature verification failed");
	const manifest = JSON.parse(
		manifestBytes.toString("utf8"),
	) as ReleaseManifest;
	if (
		![1, 2].includes(manifest.formatVersion) ||
		!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(manifest.version) ||
		!["darwin-arm64", "darwin-x64"].includes(manifest.target) ||
		!Array.isArray(manifest.files) ||
		manifest.files.length === 0 ||
		manifest.files.length > 50000 ||
		!Number.isInteger(manifest.protocolVersion) ||
		manifest.protocolVersion < 1 ||
		!Number.isInteger(manifest.schemaVersion) ||
		manifest.schemaVersion < 1 ||
		!/^\d+\.\d+(\.\d+)?$/.test(manifest.minimumMacOS) ||
		!/^\d+\.\d+\.\d+$/.test(manifest.nodeVersion) ||
		!Number.isInteger(manifest.nodeAbi) ||
		manifest.nodeAbi < 1
	)
		throw new Error("Invalid direct release manifest");
	const seen = new Set<string>();
	for (const file of manifest.files) {
		if (!file || typeof file.path !== "string")
			throw new Error("Invalid release file path");
		safeReleasePath(file.path);
		if (
			seen.has(file.path) ||
			["release-manifest.json", "release-signature.json"].includes(file.path)
		)
			throw new Error("Duplicate or reserved release path");
		seen.add(file.path);
		if (
			!/^[a-f0-9]{64}$/.test(file.sha256) ||
			!Number.isSafeInteger(file.size) ||
			file.size < 0 ||
			![0o644, 0o755].includes(file.mode)
		)
			throw new Error("Invalid release digest, size or mode");
	}
	const unpackedBytes = manifest.files.reduce(
		(sum, file) => sum + file.size,
		0,
	);
	if (
		unpackedBytes > 8 * 1024 ** 3 ||
		manifest.files.some((file) => file.size > 256 * 1024 ** 2)
	)
		throw new Error("Release payload exceeds installation limits");
	if (manifest.formatVersion === 2) {
		const archive = manifest.archive;
		if (
			!archive ||
			archive.path !== "backend.tar.gz" ||
			archive.compression !== "gzip" ||
			!Number.isSafeInteger(archive.size) ||
			archive.size < 1 ||
			archive.size > 2 * 1024 ** 3 ||
			!/^[a-f0-9]{64}$/.test(archive.sha256) ||
			archive.unpackedBytes !== unpackedBytes ||
			archive.entryCount !== manifest.files.length ||
			seen.has(archive.path)
		)
			throw new Error("Invalid signed release archive");
	} else if (manifest.archive !== undefined)
		throw new Error("V1 release cannot contain archive metadata");
	for (const path of [
		"lib/node",
		"lib/host-service-direct.js",
		"lib/direct-supervisor.js",
		"lib/direct-installer.js",
		"lib/host-worker.js",
		"lib/pty-daemon.js",
		"share/migrations/meta/_journal.json",
		"lib/chat-migrations/meta/_journal.json",
		"lib/node_modules/node-pty/package.json",
		"lib/node_modules/better-sqlite3/package.json",
		"lib/node_modules/@parcel/watcher/package.json",
		"lib/node_modules/@xterm/headless/package.json",
		"lib/node_modules/@xterm/headless/lib-headless/xterm-headless.js",
		`lib/node_modules/node-pty/prebuilds/${manifest.target}/pty.node`,
		`lib/node_modules/node-pty/prebuilds/${manifest.target}/spawn-helper`,
		"lib/node_modules/better-sqlite3/build/Release/better_sqlite3.node",
		`lib/node_modules/@parcel/watcher-${manifest.target}/watcher.node`,
		"lib/node_modules/@anthropic-ai/claude-agent-sdk/sdk.mjs",
		`lib/node_modules/@anthropic-ai/claude-agent-sdk-${manifest.target}/package.json`,
		"lib/node_modules/@agentclientprotocol/claude-agent-acp/dist/index.js",
		"lib/node_modules/@agentclientprotocol/codex-acp/dist/index.js",
		"lib/node_modules/pi-acp/dist/index.js",
	]) {
		if (!seen.has(path)) throw new Error(`Incomplete direct release: ${path}`);
	}
	if (![...seen].some((path) => path.startsWith("lib/agent-templates/")))
		throw new Error("Missing agent templates");
	if (manifest.files.find((file) => file.path === "lib/node")?.mode !== 0o755)
		throw new Error("Node runtime must be executable");
	return {
		manifest,
		manifestBytes,
		signatureBytes,
		releaseId: `${manifest.version}-${createHash("sha256").update(manifestBytes).digest("hex").slice(0, 24)}`,
	};
}

function regularFile(root: string, path: string): Buffer {
	let current = root;
	const parts = path.split("/");
	for (const [index, part] of parts.entries()) {
		current = join(current, part);
		const stat = lstatSync(current);
		if (
			stat.isSymbolicLink() ||
			(index === parts.length - 1 ? !stat.isFile() : !stat.isDirectory())
		)
			throw new Error(
				`Release payload must contain regular files and directories: ${path}`,
			);
	}
	return readFileSync(current);
}

export function verifyReleaseBundle(
	releaseRoot: string,
	trustedKeys: TrustedReleaseKeys,
): VerifiedRelease {
	const root = realpathSync(releaseRoot);
	const verified = verifyReleaseManifest(
		regularFile(root, "release-manifest.json"),
		regularFile(root, "release-signature.json"),
		trustedKeys,
	);
	if (
		verified.manifest.archive &&
		existsSync(join(root, verified.manifest.archive.path))
	) {
		const archive = verified.manifest.archive;
		if (
			readdirSync(root).sort().join("\0") !==
			[archive.path, "release-manifest.json", "release-signature.json"]
				.sort()
				.join("\0")
		)
			throw new Error("Archive release contains unexpected files");
		const path = join(root, archive.path);
		const stat = lstatSync(path);
		if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== archive.size)
			throw new Error("Release archive size or type mismatch");
		const fd = openSync(path, "r");
		try {
			const hash = createHash("sha256");
			const buffer = Buffer.allocUnsafe(1024 * 1024);
			while (true) {
				const length = readSync(fd, buffer, 0, buffer.length, null);
				if (length === 0) break;
				hash.update(buffer.subarray(0, length));
			}
			if (hash.digest("hex") !== archive.sha256)
				throw new Error("Release archive digest mismatch");
		} finally {
			closeSync(fd);
		}
		return verified;
	}
	const expected = new Set([
		"release-manifest.json",
		"release-signature.json",
		...verified.manifest.files.map((file) => file.path),
	]);
	function walk(directory: string, prefix = ""): void {
		for (const entry of readdirSync(directory, { withFileTypes: true })) {
			const path = prefix ? `${prefix}/${entry.name}` : entry.name;
			if (entry.isDirectory()) walk(join(directory, entry.name), path);
			else if (!entry.isFile())
				throw new Error(`Release payload must contain regular files: ${path}`);
			else if (!expected.has(path))
				throw new Error(`Release contains an unlisted file: ${path}`);
		}
	}
	walk(root);
	for (const file of verified.manifest.files) {
		const bytes = regularFile(root, file.path);
		if (
			bytes.length !== file.size ||
			createHash("sha256").update(bytes).digest("hex") !== file.sha256
		)
			throw new Error(`Release digest mismatch: ${file.path}`);
	}
	return verified;
}

export async function verifyReleaseArchiveAsync(
	root: string,
	trustedKeys: TrustedReleaseKeys,
): Promise<VerifiedRelease> {
	const verified = verifyReleaseManifest(
		regularFile(root, "release-manifest.json"),
		regularFile(root, "release-signature.json"),
		trustedKeys,
	);
	const archive = verified.manifest.archive;
	if (!archive) return verifyReleaseBundle(root, trustedKeys);
	if (
		readdirSync(root).sort().join("\0") !==
		[archive.path, "release-manifest.json", "release-signature.json"]
			.sort()
			.join("\0")
	)
		throw new Error("Archive release contains unexpected files");
	const path = join(root, archive.path);
	if (!lstatSync(path).isFile() || lstatSync(path).isSymbolicLink())
		throw new Error("Invalid release archive type");
	const handle = await open(path, "r");
	try {
		if ((await handle.stat()).size !== archive.size)
			throw new Error("Release archive size mismatch");
		const hash = createHash("sha256");
		const buffer = Buffer.allocUnsafe(1024 * 1024);
		while (true) {
			const bytes = (await handle.read(buffer, 0, buffer.length, null))
				.bytesRead;
			if (bytes === 0) break;
			hash.update(buffer.subarray(0, bytes));
		}
		if (hash.digest("hex") !== archive.sha256)
			throw new Error("Release archive digest mismatch");
		return verified;
	} finally {
		await handle.close();
	}
}

export function verifyExpandedReleaseMetadata(
	root: string,
	verified: VerifiedRelease,
	owner: number,
): void {
	const expected = new Map([
		...verified.manifest.files.map(
			(file) =>
				[
					file.path,
					{ size: file.size, mode: file.mode === 0o755 ? 0o555 : 0o444 },
				] as const,
		),
		[
			"release-manifest.json",
			{ size: verified.manifestBytes.length, mode: 0o444 },
		] as const,
		[
			"release-signature.json",
			{ size: verified.signatureBytes.length, mode: 0o444 },
		] as const,
	]);
	const seen = new Set<string>();
	const walk = (directory: string, prefix: string) => {
		const directoryStat = lstatSync(directory);
		if (
			!directoryStat.isDirectory() ||
			directoryStat.isSymbolicLink() ||
			directoryStat.uid !== owner ||
			(directoryStat.mode & 0o777) !== 0o755
		)
			throw new Error("Invalid candidate runtime directory permissions");
		for (const entry of readdirSync(directory, { withFileTypes: true })) {
			const path = prefix ? `${prefix}/${entry.name}` : entry.name;
			if (entry.isDirectory()) walk(join(directory, entry.name), path);
			else {
				const file = expected.get(path);
				const stat = lstatSync(join(root, path));
				if (
					!file ||
					!stat.isFile() ||
					stat.isSymbolicLink() ||
					stat.nlink !== 1 ||
					stat.uid !== owner ||
					stat.size !== file.size ||
					(stat.mode & 0o7777) !== file.mode
				)
					throw new Error("Invalid candidate runtime file metadata");
				seen.add(path);
			}
		}
	};
	walk(root, "");
	if (seen.size !== expected.size)
		throw new Error("Incomplete candidate runtime");
}

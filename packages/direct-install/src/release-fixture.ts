import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
export function createSignedReleaseFixture() {
	const root = mkdtempSync(join(tmpdir(), "direct-release-"));
	const pair = generateKeyPairSync("ed25519");
	const files = [
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
		"lib/node_modules/node-pty/prebuilds/darwin-arm64/pty.node",
		"lib/node_modules/node-pty/prebuilds/darwin-arm64/spawn-helper",
		"lib/node_modules/better-sqlite3/build/Release/better_sqlite3.node",
		"lib/node_modules/@parcel/watcher-darwin-arm64/watcher.node",
		"lib/node_modules/@anthropic-ai/claude-agent-sdk/sdk.mjs",
		"lib/node_modules/@anthropic-ai/claude-agent-sdk-darwin-arm64/package.json",
		"lib/node_modules/@agentclientprotocol/claude-agent-acp/dist/index.js",
		"lib/node_modules/@agentclientprotocol/codex-acp/dist/index.js",
		"lib/node_modules/pi-acp/dist/index.js",
		"lib/agent-templates/README.md",
	];
	const manifest = {
		formatVersion: 1,
		version: "1.0.0",
		target: "darwin-arm64",
		protocolVersion: 1,
		schemaVersion: 1,
		minimumMacOS: "12.0",
		nodeVersion: "22.13.0",
		nodeAbi: 127,
		files: files.map((path) => {
			mkdirSync(join(root, path, ".."), { recursive: true });
			writeFileSync(join(root, path), path);
			chmodSync(join(root, path), path === "lib/node" ? 0o755 : 0o644);
			return {
				path,
				sha256: createHash("sha256").update(path).digest("hex"),
				size: Buffer.byteLength(path),
				mode: path === "lib/node" ? 0o755 : 0o644,
			};
		}),
	};
	const bytes = Buffer.from(JSON.stringify(manifest));
	writeFileSync(join(root, "release-manifest.json"), bytes);
	writeFileSync(
		join(root, "release-signature.json"),
		JSON.stringify({
			keyId: "release",
			signature: sign(null, bytes, pair.privateKey).toString("base64"),
		}),
	);
	return {
		root,
		manifest,
		pair,
		keys: {
			release: pair.publicKey
				.export({ type: "spki", format: "pem" })
				.toString(),
		},
	};
}

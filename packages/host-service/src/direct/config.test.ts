import { afterEach, expect, test } from "bun:test";
import {
	chmodSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	loadDirectConfig,
	publishDirectEndpoint,
	readDirectSecret,
} from "./config";

const roots: string[] = [];
afterEach(() => {
	for (const root of roots.splice(0))
		rmSync(root, { recursive: true, force: true });
});

function fixture() {
	const homeDir = mkdtempSync(join(tmpdir(), "superset-direct-config-"));
	roots.push(homeDir);
	const secretFile = join(homeDir, "secret");
	writeFileSync(secretFile, "a".repeat(64), { mode: 0o600 });
	return {
		backendId: "00000000-0000-4000-8000-000000000001",
		namespaceId: "00000000-0000-4000-8000-000000000002",
		homeDir,
		secretFile,
		migrationsFolder: join(homeDir, "migrations"),
	};
}

test("direct configuration needs no Superset account, relay or cloud URL", () => {
	const config = fixture();
	const path = join(config.homeDir, "config.json");
	writeFileSync(path, JSON.stringify(config), { mode: 0o600 });
	expect(loadDirectConfig(path)).toMatchObject({
		...config,
		allowedOrigins: [],
	});
	expect(readDirectSecret(config.secretFile)).toBe("a".repeat(64));
});

test("a readable-by-others secret cannot start a direct backend", () => {
	const config = fixture();
	chmodSync(config.secretFile, 0o644);
	expect(() => readDirectSecret(config.secretFile)).toThrow("owner-only");
});

test("endpoint publication is owner-only and includes authenticated backend identity", () => {
	const config = fixture();
	const endpoint = {
		backendId: config.backendId,
		namespaceId: config.namespaceId,
		instanceId: "instance-1",
		port: 34567,
		serviceUid: process.getuid?.() ?? 0,
		runtimeMode: "direct" as const,
		protocolVersion: 1 as const,
	};
	const path = publishDirectEndpoint(config.homeDir, endpoint);
	expect(JSON.parse(readFileSync(path, "utf8"))).toEqual(endpoint);
	expect(require("node:fs").statSync(path).mode & 0o777).toBe(0o600);
});

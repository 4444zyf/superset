import { afterEach, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import {
	mkdtempSync,
	renameSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { LocalBackendOptions, LocalConnection } from "./local";
import { LocalNamespaceBackend } from "./local-namespaces";

const roots: string[] = [];
afterEach(() => {
	for (const path of roots.splice(0))
		rmSync(path, { recursive: true, force: true });
});
function fixture() {
	const dataDir = mkdtempSync(join(tmpdir(), "namespace-catalog-"));
	roots.push(dataDir);
	const original = { backendId: randomUUID(), namespaceId: randomUUID() };
	const calls: Array<{ directory: string; action: string }> = [];
	let resolveConnect: ((connection: LocalConnection) => void) | undefined;
	const createBackend = (options: LocalBackendOptions) => ({
		describeNamespace: () => options.namespaceIdentity ?? original,
		test: async () => ({
			installed: true,
			platform: "linux",
			architecture: "x64",
			uid: process.getuid?.() ?? 1000,
			user: "agent",
			homeDir: dataDir,
		}),
		connect: () =>
			new Promise<LocalConnection>((resolve) => {
				resolveConnect = resolve;
			}),
		control: async (action: string) => {
			calls.push({ directory: options.dataDir, action });
			return { status: "completed" as const };
		},
		importLocalData: async () => {
			throw new Error("not used");
		},
	});
	const backend = new LocalNamespaceBackend({
		dataDir,
		execPath: process.execPath,
		supervisorPath: "/app/supervisor.js",
		hostServicePath: "/app/backend.js",
		migrationsFolder: "/app/migrations",
		chatMigrationsFolder: "/app/chat-migrations",
		createBackend,
	});
	return {
		backend,
		dataDir,
		original,
		calls,
		complete: (connection: LocalConnection) => resolveConnect?.(connection),
	};
}
test("namespace creation preserves the existing identity and switching never stops its workload", () => {
	const f = fixture();
	const first = f.backend.listNamespaces()[0];
	expect(first?.namespaceId).toBe(f.original.namespaceId);
	const second = f.backend.createNamespace("Imported other organization");
	expect(second.namespaceId).not.toBe(first?.namespaceId);
	expect(f.backend.listNamespaces()).toHaveLength(2);
	f.backend.selectNamespace(second.id);
	expect(f.backend.listNamespaces().find((entry) => entry.selected)?.id).toBe(
		second.id,
	);
	expect(f.calls).toEqual([]);
});
test("a connection that resolves after namespace selection closes only its own provisional proxy", async () => {
	const f = fixture();
	const first = f.backend.listNamespaces()[0];
	const second = f.backend.createNamespace("Second");
	const connection = f.backend.connect();
	f.backend.selectNamespace(second.id);
	let closes = 0;
	f.complete({
		descriptor: {
			backendId: first?.backendId,
			namespaceId: first?.namespaceId,
			instanceId: "instance",
			protocolVersion: 1,
			runtimeMode: "direct",
			serviceUid: process.getuid?.(),
			port: 12345,
		},
		secret: "a".repeat(64),
		url: "http://127.0.0.1:12345",
		close: () => {
			closes++;
		},
	} as LocalConnection);
	await expect(connection).rejects.toThrow("selection changed");
	expect(closes).toBe(1);
	expect(f.calls).toEqual([]);
});
test("Stop captures the namespace at invocation rather than a later selection", async () => {
	const f = fixture();
	f.backend.listNamespaces();
	const stopping = f.backend.control("stop");
	const second = f.backend.createNamespace("Second");
	f.backend.selectNamespace(second.id);
	await stopping;
	expect(f.calls).toEqual([{ directory: f.dataDir, action: "stop" }]);
});
test("catalog reads reject symlinks instead of following an external file", () => {
	const f = fixture();
	const external = join(f.dataDir, "external.json");
	writeFileSync(external, "{}", { mode: 0o600 });
	symlinkSync(external, join(f.dataDir, "local-namespaces.json"));
	expect(() => f.backend.listNamespaces()).toThrow();
});

test("a cached namespace rejects a replaced linked parent before selection changes", () => {
	const f = fixture();
	const original = f.backend.listNamespaces()[0];
	const second = f.backend.createNamespace("Second");
	const parent = join(f.dataDir, "namespaces");
	const moved = join(f.dataDir, "moved-namespaces");
	renameSync(parent, moved);
	symlinkSync(moved, parent);
	expect(() => f.backend.selectNamespace(second.id)).toThrow(
		"owner-only real directories",
	);
	expect(f.backend.listNamespaces().find((entry) => entry.selected)?.id).toBe(
		original?.id,
	);
	expect(f.calls).toEqual([]);
});

test("removing an inactive namespace retains its data and refuses unresolved imports", () => {
	const f = fixture();
	f.backend.listNamespaces();
	const entry = f.backend.createNamespace("Imported");
	const directory = join(f.dataDir, "namespaces", entry.id);
	const lock = join(directory, "state", "legacy-import.lock");
	writeFileSync(lock, "{}", { mode: 0o600 });
	expect(() => f.backend.removeNamespace(entry.id)).toThrow(
		"unresolved import",
	);
	rmSync(lock);
	writeFileSync(join(directory, "retained-data"), "keep", { mode: 0o600 });
	f.backend.removeNamespace(entry.id);
	expect(f.backend.listNamespaces()).toHaveLength(1);
	expect(() => f.backend.selectNamespace(entry.id)).toThrow(
		"Unknown local namespace",
	);
	expect(
		require("node:fs").readFileSync(join(directory, "retained-data"), "utf8"),
	).toBe("keep");
});

test("a failed new namespace import withdraws only its empty catalog entry", async () => {
	const f = fixture();
	f.backend.listNamespaces();
	await expect(
		f.backend.importLocalData("/tmp/legacy-source", {
			createNamespace: true,
			label: "Failed import",
		}),
	).rejects.toThrow("not used");
	expect(f.backend.listNamespaces()).toHaveLength(1);
	expect(f.backend.listNamespaces()[0]?.namespaceId).toBe(
		f.original.namespaceId,
	);
});

test("a live catalog recovery owner excludes another stale-lock recovery", () => {
	const f = fixture();
	f.backend.listNamespaces();
	symlinkSync(
		`superset-local-catalog-2147483647-${randomUUID()}`,
		join(f.dataDir, "local-namespaces.lock"),
	);
	symlinkSync(
		`superset-local-catalog-${process.pid}-${randomUUID()}`,
		join(f.dataDir, "local-namespaces.lock.recovery"),
	);
	expect(() => f.backend.createNamespace("Must not overlap recovery")).toThrow(
		"update is in progress",
	);
	expect(f.backend.listNamespaces()).toHaveLength(1);
});

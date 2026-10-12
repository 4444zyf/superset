import { Database } from "bun:sqlite";
import { afterEach, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ImportDatabase } from "./legacy-import";
import { discoverLegacySources, previewLegacySources } from "./legacy-sources";

const roots: string[] = [];

test("private previews expose UUID and path conflicts across sources while retaining every namespace", async () => {
	const root = home(),
		sharedProject = randomUUID(),
		sharedWorkspace = randomUUID();
	for (const organization of ["old-one", "old-two"]) {
		const path = join(root, ".superset", "host", organization);
		mkdirSync(path, { recursive: true, mode: 0o700 });
		const db = new Database(join(path, "host.db"));
		db.exec(
			"CREATE TABLE projects(id TEXT,repo_path TEXT,deleted_at INTEGER); CREATE TABLE workspaces(id TEXT,project_id TEXT,worktree_path TEXT,archived_at INTEGER); CREATE TABLE terminal_sessions(id TEXT)",
		);
		db.prepare("INSERT INTO projects VALUES(?,?,NULL)").run(
			sharedProject,
			join(root, "repo"),
		);
		db.prepare("INSERT INTO workspaces VALUES(?,?,?,NULL)").run(
			sharedWorkspace,
			sharedProject,
			join(root, "worktree"),
		);
		db.close(true);
	}
	const sources = discoverLegacySources({ userHomeDir: root }).sources;
	const before = sources.map((source) =>
		readFileSync(join(source.sourceDirectory, "host.db")),
	);
	const openDatabase = (path: string, readonly: boolean): ImportDatabase => {
		const db = new Database(path, { readonly });
		return {
			exec: (sql) => db.exec(sql),
			prepare: (sql) => db.prepare(sql),
			backup: async (destination) =>
				writeFileSync(destination, db.serialize(), { mode: 0o600 }),
			close: () => db.close(true),
		};
	};
	const report = await previewLegacySources(
		{ sources, stagingDirectory: root },
		{ openDatabase, probeWriters: async () => [] },
	);
	expect(report.sources.map((source) => source.status)).toEqual([
		"ready",
		"ready",
	]);
	expect(report.strategy).toBe("separate-namespaces");
	expect(report.conflicts.map((conflict) => conflict.kind).sort()).toEqual([
		"project-id",
		"repository-path",
		"workspace-id",
		"workspace-path",
	]);
	expect(
		report.conflicts.every((conflict) => conflict.sourceIds.length === 2),
	).toBe(true);
	expect(
		sources.map((source) =>
			readFileSync(join(source.sourceDirectory, "host.db")),
		),
	).toEqual(before);
});

test("preview refuses active source writers before opening even a private snapshot", async () => {
	const root = home();
	file(join(root, ".superset", "local.db"));
	const report = await previewLegacySources(
		{
			sources: discoverLegacySources({ userHomeDir: root }).sources,
			stagingDirectory: root,
		},
		{
			probeWriters: async () => [12345],
			openDatabase: () => {
				throw new Error("SQLite must not open");
			},
		},
	);
	expect(report.sources[0]?.status).toBe("blocked");
	expect(report.sources[0]?.reason).toContain("writer");
	expect(report.conflicts).toEqual([]);
});
afterEach(() => {
	for (const path of roots.splice(0))
		rmSync(path, { recursive: true, force: true });
});
function home() {
	const root = mkdtempSync(join(tmpdir(), "legacy-discovery-"));
	roots.push(root);
	return root;
}
function file(path: string) {
	mkdirSync(join(path, ".."), { recursive: true, mode: 0o700 });
	writeFileSync(path, "discovery never opens SQLite", { mode: 0o600 });
}

test("discovers v1 and each v2 namespace from this user's known homes without changing database bytes", () => {
	const root = home();
	const v1 = join(root, ".superset", "local.db"),
		v2 = join(root, ".superset", "host", "old-org", "host.db"),
		custom = join(root, ".superset-worktree", "host", "second-org", "host.db");
	for (const path of [v1, v2, custom]) file(path);
	file(join(root, "unrelated-application", "local.db"));
	const before = [v1, v2, custom].map((path) => readFileSync(path));
	const result = discoverLegacySources({ userHomeDir: root });
	expect(
		result.sources
			.map((source) => [source.format, source.sourceNamespace])
			.sort(),
	).toEqual([
		["v1", ".superset"],
		["v2", "old-org"],
		["v2", "second-org"],
	]);
	expect(new Set(result.sources.map((source) => source.id)).size).toBe(3);
	expect(
		discoverLegacySources({ userHomeDir: root }).sources.map(
			(source) => source.id,
		),
	).toEqual(result.sources.map((source) => source.id));
	expect([v1, v2, custom].map((path) => readFileSync(path))).toEqual(before);
});

test("does not follow linked homes, namespaces or database files", () => {
	const root = home(),
		outside = home();
	file(join(outside, "local.db"));
	symlinkSync(outside, join(root, ".superset-linked"));
	mkdirSync(join(root, ".superset", "host"), { recursive: true, mode: 0o700 });
	symlinkSync(outside, join(root, ".superset", "host", "linked-org"));
	symlinkSync(join(outside, "local.db"), join(root, ".superset", "local.db"));
	const result = discoverLegacySources({ userHomeDir: root });
	expect(result.sources).toEqual([]);
	expect(
		result.issues.filter((issue) => issue.reason === "symlink").length,
	).toBe(3);
});

test("refuses a home owned by another OS identity", () => {
	const root = home();
	file(join(root, ".superset", "local.db"));
	const result = discoverLegacySources({
		userHomeDir: root,
		uid: (process.getuid?.() ?? 1000) + 1,
	});
	expect(result.sources).toEqual([]);
	expect(result.issues).toEqual([{ path: root, reason: "foreign-owner" }]);
});

test("reports nonregular database candidates without opening or blocking on them", () => {
	const root = home();
	mkdirSync(join(root, ".superset", "local.db"), {
		recursive: true,
		mode: 0o700,
	});
	const result = discoverLegacySources({ userHomeDir: root });
	expect(result.sources).toEqual([]);
	expect(result.issues).toEqual([
		{ path: join(root, ".superset", "local.db"), reason: "not-regular" },
	]);
});

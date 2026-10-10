import { Database } from "bun:sqlite";
import { afterEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	statSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mapLegacyV1Snapshot, stageLegacyV1History } from "./legacy-v1";

const PROJECT = "00000000-0000-4000-8000-000000000001";
const WORKSPACE = "00000000-0000-4000-8000-000000000002";
const WORKTREE = "00000000-0000-4000-8000-000000000003";
const TERMINAL = "00000000-0000-4000-8000-000000000004";
const SECOND = "00000000-0000-4000-8000-000000000005";
const paths: string[] = [];
const databases: Database[] = [];
afterEach(() => {
	for (const db of databases.splice(0)) db.close();
	for (const path of paths.splice(0))
		rmSync(path, { recursive: true, force: true });
});
function fixture() {
	const root = mkdtempSync(join(tmpdir(), "direct-legacy-v1-"));
	paths.push(root);
	const db = new Database(":memory:");
	databases.push(db);
	db.exec(`CREATE TABLE projects(id TEXT PRIMARY KEY,main_repo_path TEXT,name TEXT,color TEXT,created_at INTEGER,last_opened_at INTEGER);
CREATE TABLE worktrees(id TEXT PRIMARY KEY,project_id TEXT,path TEXT,branch TEXT,base_branch TEXT);
CREATE TABLE workspaces(id TEXT PRIMARY KEY,project_id TEXT,worktree_id TEXT,type TEXT,branch TEXT,name TEXT,created_at INTEGER,updated_at INTEGER,last_opened_at INTEGER);
CREATE TABLE settings(terminal_presets TEXT,active_organization_id TEXT);`);
	db.prepare("INSERT INTO projects VALUES (?,?,?,?,?,?)").run(
		PROJECT,
		join(root, "repo"),
		"Old project",
		"#abcdef",
		11,
		15,
	);
	db.prepare("INSERT INTO worktrees VALUES (?,?,?,?,?)").run(
		WORKTREE,
		PROJECT,
		join(root, "worktree"),
		"feature",
		"main",
	);
	db.prepare("INSERT INTO workspaces VALUES (?,?,?,?,?,?,?,?,?)").run(
		WORKSPACE,
		PROJECT,
		WORKTREE,
		"worktree",
		"feature",
		"Old workspace",
		12,
		14,
		16,
	);
	db.prepare("INSERT INTO settings VALUES (?,?)").run(
		JSON.stringify([
			{ command: "old-hook", env: { SUP_SECRET: "must not copy" } },
		]),
		"old-org",
	);
	const appState = {
		tabsState: {
			tabs: [{ id: "tab", workspaceId: WORKSPACE }],
			panes: {
				[TERMINAL]: {
					id: TERMINAL,
					tabId: "tab",
					type: "terminal",
					userTitle: "Named",
					cwd: join(root, "worktree"),
				},
			},
		},
		v1AgentSessions: {
			[TERMINAL]: {
				agentId: "codex",
				agentSessionId: "provider-session-id",
				prompted: true,
				updatedAt: 17,
				token: "must not copy",
			},
		},
	};
	return { root, db, appState };
}
test("maps only provable v1 metadata without changing the snapshot or inventing an actor", () => {
	const f = fixture();
	const before = createHash("sha256").update(f.db.serialize()).digest("hex");
	const mapped = mapLegacyV1Snapshot({
		database: f.db,
		appState: f.appState,
		importedAt: 100,
	});
	expect(mapped.projects).toMatchObject([
		{
			id: PROJECT,
			repo_path: join(f.root, "repo"),
			name: "Old project",
			created_at: 11,
		},
	]);
	expect(mapped.workspaces).toMatchObject([
		{
			id: WORKSPACE,
			project_id: PROJECT,
			worktree_path: join(f.root, "worktree"),
			type: "worktree",
			created_by_user_id: null,
			created_at: 12,
			updated_at: 14,
		},
	]);
	expect(mapped.terminalSessions).toMatchObject([
		{
			id: TERMINAL,
			origin_workspace_id: WORKSPACE,
			status: "exited",
			ended_at: 100,
			custom_title: "Named",
		},
	]);
	expect(mapped.terminalAgentBindings).toMatchObject([
		{
			terminal_id: TERMINAL,
			workspace_id: WORKSPACE,
			agent_id: "codex",
			agent_session_id: "provider-session-id",
			ended_at: 100,
			end_reason: "terminal-exited",
		},
	]);
	expect(mapped.missingActors).toEqual([WORKSPACE]);
	expect(mapped.rejections).toEqual([]);
	expect(JSON.stringify(mapped)).not.toContain("must not copy");
	expect(createHash("sha256").update(f.db.serialize()).digest("hex")).toBe(
		before,
	);
});
test("maps branch workspaces to the existing primary checkout without reading Git or rewriting IDs", () => {
	const f = fixture();
	f.db.prepare("UPDATE workspaces SET type='branch',worktree_id=NULL").run();
	const mapped = mapLegacyV1Snapshot({ database: f.db, importedAt: 100 });
	expect(mapped.workspaces).toMatchObject([
		{ id: WORKSPACE, type: "local", worktree_path: join(f.root, "repo") },
	]);
	expect(mapped.terminalSessions).toEqual([]);
});

test("preserves two v1 branch workspaces that legitimately share their own project's primary checkout", () => {
	const f = fixture();
	f.db.prepare("UPDATE workspaces SET type='branch',worktree_id=NULL").run();
	f.db
		.prepare("INSERT INTO workspaces VALUES (?,?,?,?,?,?,?,?,?)")
		.run(SECOND, PROJECT, null, "branch", "other", "Second branch", 12, 14, 16);
	const mapped = mapLegacyV1Snapshot({ database: f.db, importedAt: 100 });
	expect(mapped.workspaces.map((row) => row.id)).toEqual([WORKSPACE, SECOND]);
	expect(
		mapped.workspaces.every(
			(row) => row.worktree_path === join(f.root, "repo"),
		),
	).toBe(true);
	expect(mapped.rejections).toEqual([]);
});

test("reports duplicate tab identities that assign the same pane to different workspaces", () => {
	const f = fixture();
	f.appState.tabsState.tabs.push({ id: "tab", workspaceId: SECOND });
	const mapped = mapLegacyV1Snapshot({
		database: f.db,
		appState: f.appState,
		importedAt: 100,
	});
	expect(mapped.terminalSessions).toEqual([]);
	expect(mapped.rejections).toContainEqual({
		kind: "terminal",
		id: TERMINAL,
		reason: "workspace-conflict",
	});
});
test("reports non-UUID entries and every conflicting path instead of silently renaming or selecting a winner", () => {
	const f = fixture();
	f.db
		.prepare("INSERT INTO projects VALUES (?,?,?,?,?,?)")
		.run(SECOND, join(f.root, "repo"), "Conflicting", "default", 1, 1);
	f.db
		.prepare("INSERT INTO projects VALUES (?,?,?,?,?,?)")
		.run("legacy-id", join(f.root, "other"), "Legacy", "default", 1, 1);
	const mapped = mapLegacyV1Snapshot({
		database: f.db,
		appState: f.appState,
		importedAt: 100,
	});
	expect(mapped.projects).toEqual([]);
	expect(mapped.workspaces).toEqual([]);
	expect(mapped.rejections).toEqual(
		expect.arrayContaining([
			{ kind: "project", id: PROJECT, reason: "path-conflict" },
			{ kind: "project", id: SECOND, reason: "path-conflict" },
			{ kind: "project", id: "legacy-id", reason: "invalid-uuid" },
			{ kind: "workspace", id: WORKSPACE, reason: "missing-project" },
		]),
	);
});
test("rejects a pane mapped to two workspaces across windows and preserves cleanly ended agent metadata", () => {
	const f = fixture();
	const appState = {
		...f.appState,
		tabsStateByWindow: {
			second: {
				tabs: [{ id: "another", workspaceId: SECOND }],
				panes: {
					[TERMINAL]: { id: TERMINAL, tabId: "another", type: "terminal" },
				},
			},
		},
	};
	const conflict = mapLegacyV1Snapshot({
		database: f.db,
		appState,
		importedAt: 100,
	});
	expect(conflict.terminalSessions).toEqual([]);
	expect(conflict.rejections).toContainEqual({
		kind: "terminal",
		id: TERMINAL,
		reason: "workspace-conflict",
	});
	f.appState.v1AgentSessions[TERMINAL] = {
		...f.appState.v1AgentSessions[TERMINAL],
		endedAt: 19,
	} as (typeof f.appState.v1AgentSessions)[typeof TERMINAL];
	const clean = mapLegacyV1Snapshot({
		database: f.db,
		appState: f.appState,
		importedAt: 100,
	});
	expect(clean.terminalAgentBindings[0]).toMatchObject({
		agent_session_id: "provider-session-id",
		end_reason: "detached",
		ended_at: 19,
	});
});
test("archives original history bytes and captured session metadata as static owner-only files", () => {
	const f = fixture();
	const source = join(f.root, "source-history");
	const history = join(source, WORKSPACE, TERMINAL);
	mkdirSync(history, { recursive: true, mode: 0o700 });
	const meta = Buffer.from(
		JSON.stringify({
			cwd: join(f.root, "worktree"),
			cols: 80,
			rows: 24,
			startedAt: "2026-01-01T00:00:00Z",
		}),
	);
	const scrollback = Buffer.from("old output\n\u001b[31mcontext\u001b[0m\n");
	writeFileSync(join(history, "meta.json"), meta, { mode: 0o600 });
	writeFileSync(join(history, "scrollback.bin"), scrollback, { mode: 0o600 });
	const archiveDir = join(f.root, "archive");
	const mapped = mapLegacyV1Snapshot({
		database: f.db,
		appState: f.appState,
		importedAt: 100,
	});
	const staged = stageLegacyV1History({
		sourceHistoryDir: source,
		archiveDir,
		historyCopies: mapped.historyCopies,
	});
	expect(staged.rejections).toEqual([]);
	expect(staged.archives).toMatchObject([
		{ workspaceId: WORKSPACE, terminalId: TERMINAL },
	]);
	const archive = join(archiveDir, WORKSPACE, TERMINAL);
	expect(readFileSync(join(archive, "meta.json"))).toEqual(meta);
	expect(readFileSync(join(archive, "scrollback.bin"))).toEqual(scrollback);
	expect(readFileSync(join(history, "meta.json"))).toEqual(meta);
	expect(readFileSync(join(history, "scrollback.bin"))).toEqual(scrollback);
	expect(statSync(join(archive, "scrollback.bin")).mode & 0o777).toBe(0o600);
	expect(
		JSON.parse(readFileSync(join(archive, "agent-session.json"), "utf8")),
	).toEqual({
		agentId: "codex",
		agentSessionId: "provider-session-id",
		prompted: true,
		updatedAt: 17,
	});
});
test("rejects a symlinked history file without copying its target or publishing a partial archive", () => {
	const f = fixture();
	const source = join(f.root, "source-history");
	const history = join(source, WORKSPACE, TERMINAL);
	mkdirSync(history, { recursive: true, mode: 0o700 });
	writeFileSync(
		join(history, "meta.json"),
		JSON.stringify({
			cwd: join(f.root, "worktree"),
			cols: 80,
			rows: 24,
			startedAt: "2026-01-01T00:00:00Z",
		}),
		{ mode: 0o600 },
	);
	const secret = join(f.root, "secret");
	writeFileSync(secret, "must not copy", { mode: 0o600 });
	symlinkSync(secret, join(history, "scrollback.bin"));
	const archiveDir = join(f.root, "archive");
	const mapped = mapLegacyV1Snapshot({
		database: f.db,
		appState: f.appState,
		importedAt: 100,
	});
	const staged = stageLegacyV1History({
		sourceHistoryDir: source,
		archiveDir,
		historyCopies: mapped.historyCopies,
	});
	expect(staged.archives).toEqual([]);
	expect(staged.rejections).toContainEqual({
		kind: "history",
		id: TERMINAL,
		reason: "unsafe-history",
	});
	expect(existsSync(join(archiveDir, WORKSPACE, TERMINAL))).toBe(false);
	expect(readFileSync(secret, "utf8")).toBe("must not copy");
});

test("retains static history whose closed pane is no longer in app-state without fabricating a live terminal", () => {
	const f = fixture();
	const source = join(f.root, "source-history");
	const history = join(source, WORKSPACE, SECOND);
	mkdirSync(history, { recursive: true, mode: 0o700 });
	const metadata = JSON.stringify({
		cwd: join(f.root, "worktree"),
		cols: 80,
		rows: 24,
		startedAt: "2026-01-01T00:00:00Z",
		endedAt: "2026-01-01T00:01:00Z",
		exitCode: 0,
	});
	writeFileSync(join(history, "meta.json"), metadata, { mode: 0o600 });
	writeFileSync(join(history, "scrollback.bin"), "closed history", {
		mode: 0o600,
	});
	const mapped = mapLegacyV1Snapshot({ database: f.db, importedAt: 100 });
	const archiveDir = join(f.root, "archive");
	const staged = stageLegacyV1History({
		sourceHistoryDir: source,
		archiveDir,
		historyCopies: mapped.historyCopies,
	});
	expect(mapped.terminalSessions).toEqual([]);
	expect(staged.archives).toMatchObject([
		{ workspaceId: WORKSPACE, terminalId: SECOND },
	]);
	expect(
		readFileSync(join(archiveDir, WORKSPACE, SECOND, "meta.json"), "utf8"),
	).toBe(metadata);
	expect(
		readFileSync(join(archiveDir, WORKSPACE, SECOND, "scrollback.bin"), "utf8"),
	).toBe("closed history");
});

test("preserves validated provider capture for an archived closed pane without creating terminal rows", () => {
	const f = fixture();
	Reflect.deleteProperty(f.appState.tabsState.panes, TERMINAL);
	const source = join(f.root, "source-history");
	const history = join(source, WORKSPACE, TERMINAL);
	mkdirSync(history, { recursive: true, mode: 0o700 });
	writeFileSync(
		join(history, "meta.json"),
		JSON.stringify({
			cwd: join(f.root, "worktree"),
			cols: 80,
			rows: 24,
			startedAt: "2026-01-01T00:00:00Z",
		}),
		{ mode: 0o600 },
	);
	writeFileSync(join(history, "scrollback.bin"), "closed history", {
		mode: 0o600,
	});
	const mapped = mapLegacyV1Snapshot({
		database: f.db,
		appState: f.appState,
		importedAt: 100,
	});
	const archiveDir = join(f.root, "archive");
	const staged = stageLegacyV1History({
		sourceHistoryDir: source,
		archiveDir,
		historyCopies: mapped.historyCopies,
		agentCaptures: mapped.agentCaptures,
	});
	expect(mapped.terminalSessions).toEqual([]);
	expect(mapped.terminalAgentBindings).toEqual([]);
	expect(staged.rejections).toEqual([]);
	expect(
		JSON.parse(
			readFileSync(
				join(archiveDir, WORKSPACE, TERMINAL, "agent-session.json"),
				"utf8",
			),
		),
	).toEqual({
		agentId: "codex",
		agentSessionId: "provider-session-id",
		prompted: true,
		updatedAt: 17,
	});
	expect(JSON.stringify(mapped.agentCaptures)).not.toContain("must not copy");
});

test("rejects the workspace attribution of a provider capture when its terminal UUID has multiple historical workspaces", () => {
	const f = fixture();
	Reflect.deleteProperty(f.appState.tabsState.panes, TERMINAL);
	const source = join(f.root, "source-history");
	for (const workspaceId of [WORKSPACE, SECOND]) {
		const history = join(source, workspaceId, TERMINAL);
		mkdirSync(history, { recursive: true, mode: 0o700 });
		writeFileSync(
			join(history, "meta.json"),
			JSON.stringify({
				cwd: join(f.root, "worktree"),
				cols: 80,
				rows: 24,
				startedAt: "2026-01-01T00:00:00Z",
			}),
			{ mode: 0o600 },
		);
		writeFileSync(join(history, "scrollback.bin"), "closed history", {
			mode: 0o600,
		});
	}
	const mapped = mapLegacyV1Snapshot({
		database: f.db,
		appState: f.appState,
		importedAt: 100,
	});
	const archiveDir = join(f.root, "archive");
	const staged = stageLegacyV1History({
		sourceHistoryDir: source,
		archiveDir,
		historyCopies: mapped.historyCopies,
		agentCaptures: mapped.agentCaptures,
	});
	expect(staged.archives).toEqual([]);
	expect(staged.rejections).toContainEqual({
		kind: "history",
		id: TERMINAL,
		reason: "workspace-conflict",
	});
	expect(
		existsSync(join(archiveDir, WORKSPACE, TERMINAL, "agent-session.json")),
	).toBe(false);
	expect(
		existsSync(join(archiveDir, SECOND, TERMINAL, "agent-session.json")),
	).toBe(false);
});

test("the static archive revalidates and whitelists agent captures passed by its caller", () => {
	const f = fixture();
	const source = join(f.root, "source-history");
	const history = join(source, WORKSPACE, TERMINAL);
	mkdirSync(history, { recursive: true, mode: 0o700 });
	writeFileSync(
		join(history, "meta.json"),
		JSON.stringify({
			cwd: join(f.root, "repo"),
			cols: 80,
			rows: 24,
			startedAt: "2026-01-01T00:00:00Z",
		}),
		{ mode: 0o600 },
	);
	writeFileSync(join(history, "scrollback.bin"), "output", { mode: 0o600 });
	const mapped = mapLegacyV1Snapshot({
		database: f.db,
		appState: f.appState,
		importedAt: 100,
	});
	const capture = mapped.historyCopies[0]?.agentCapture;
	if (!capture) throw new Error("Fixture requires a captured agent session");
	Object.assign(capture, {
		token: "must not copy",
		env: { AUTH_TOKEN: "must not copy" },
	});
	const archiveDir = join(f.root, "archive");
	const staged = stageLegacyV1History({
		sourceHistoryDir: source,
		archiveDir,
		historyCopies: mapped.historyCopies,
	});
	expect(JSON.stringify(staged)).not.toContain("must not copy");
	expect(
		readFileSync(
			join(archiveDir, WORKSPACE, TERMINAL, "agent-session.json"),
			"utf8",
		),
	).not.toContain("must not copy");
});

test("archives only validated display metadata and leaves legacy environment, shell and hook settings in the source", () => {
	const f = fixture();
	const source = join(f.root, "source-history");
	const history = join(source, WORKSPACE, TERMINAL);
	mkdirSync(history, { recursive: true, mode: 0o700 });
	const display = {
		cwd: join(f.root, "worktree"),
		cols: 80,
		rows: 24,
		startedAt: "2026-01-01T00:00:00Z",
		endedAt: "2026-01-01T00:01:00Z",
		exitCode: 0,
	};
	const metadata = JSON.stringify({
		...display,
		env: { AUTH_TOKEN: "old-token" },
		shell: "old-shell",
		argv: ["old-command"],
		mcp: { token: "old-token" },
		hooks: ["old-hook"],
	});
	writeFileSync(join(history, "meta.json"), metadata, { mode: 0o600 });
	writeFileSync(join(history, "scrollback.bin"), "original output", {
		mode: 0o600,
	});
	const archiveDir = join(f.root, "archive");
	stageLegacyV1History({
		sourceHistoryDir: source,
		archiveDir,
		historyCopies: [],
	});
	const archived = readFileSync(
		join(archiveDir, WORKSPACE, TERMINAL, "meta.json"),
		"utf8",
	);
	expect(JSON.parse(archived)).toEqual(display);
	expect(archived).not.toContain("old-token");
	expect(readFileSync(join(history, "meta.json"), "utf8")).toBe(metadata);
	expect(
		readFileSync(
			join(archiveDir, WORKSPACE, TERMINAL, "scrollback.bin"),
			"utf8",
		),
	).toBe("original output");
});

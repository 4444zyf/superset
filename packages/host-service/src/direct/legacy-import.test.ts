import { Database } from "bun:sqlite";
import { afterEach, expect, test } from "bun:test";
import { createHash, randomUUID } from "node:crypto";
import {
	chmodSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { runMigrations } from "@superset/shared/sqlite-migrations";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import {
	type ImportDatabase,
	importLegacyNamespace,
	recoverLegacyImport,
} from "./legacy-import";

const HOST_MIGRATIONS = resolve(import.meta.dir, "../../drizzle");
const CHAT_MIGRATIONS = resolve(
	import.meta.dir,
	"../../../chat-runtime/src/db/drizzle",
);
const temporary: string[] = [];
afterEach(() => {
	for (const path of temporary.splice(0))
		rmSync(path, { recursive: true, force: true });
});

function openDatabase(path: string, readonly: boolean): ImportDatabase {
	const db = new Database(path, { readonly, create: !readonly });
	return {
		exec: (sql) => db.exec(sql),
		prepare: (sql) => db.prepare(sql),
		close: () => db.close(true),
		backup: async (destination) => {
			writeFileSync(destination, db.serialize(), { mode: 0o600 });
		},
	};
}
async function initializeDatabase(kind: "host" | "chat", path: string) {
	const db = new Database(path);
	if (kind === "host") runMigrations(drizzle(db), HOST_MIGRATIONS);
	else migrate(drizzle(db), { migrationsFolder: CHAT_MIGRATIONS });
	db.close(true);
}
async function fixture() {
	const root = mkdtempSync(join(tmpdir(), "legacy-direct-import-"));
	temporary.push(root);
	const source = join(root, "old", "host", "old-org");
	mkdirSync(source, { recursive: true, mode: 0o700 });
	const home = join(root, "new");
	mkdirSync(join(home, "state"), { recursive: true, mode: 0o700 });
	const namespaceId = randomUUID();
	const configPath = join(home, "service-config.json");
	writeFileSync(
		configPath,
		JSON.stringify({
			backendId: randomUUID(),
			namespaceId,
			homeDir: home,
			secretFile: join(home, "secret"),
			migrationsFolder: HOST_MIGRATIONS,
			chatMigrationsFolder: CHAT_MIGRATIONS,
			installationMode: "local",
		}),
		{ mode: 0o600 },
	);
	writeFileSync(join(home, "state", "disabled"), "stopped", { mode: 0o600 });
	await initializeDatabase("host", join(source, "host.db"));
	await initializeDatabase("chat", join(source, "chat.db"));
	const repo = join(root, "repository");
	mkdirSync(repo);
	const worktree = join(root, "worktree");
	mkdirSync(worktree);
	const projectId = randomUUID(),
		workspaceId = randomUUID(),
		terminalId = randomUUID(),
		sessionId = randomUUID();
	const db = new Database(join(source, "host.db"));
	db.exec("PRAGMA journal_mode=WAL");
	db.prepare(
		"INSERT INTO projects(id,repo_path,name,created_at) VALUES (?,?,?,1)",
	).run(projectId, repo, "Legacy repo");
	db.prepare(
		"INSERT INTO workspaces(id,project_id,worktree_path,branch,name,created_by_user_id,created_at) VALUES (?,?,?,?,?,?,1)",
	).run(
		workspaceId,
		projectId,
		worktree,
		"feature",
		"Legacy workspace",
		"old-actor",
	);
	db.prepare(
		"INSERT INTO terminal_sessions(id,origin_workspace_id,status,created_at) VALUES (?,?,'active',1)",
	).run(terminalId, workspaceId);
	db.prepare(
		"INSERT INTO terminal_agent_bindings(terminal_id,workspace_id,agent_id,agent_session_id,started_at,last_event_at,last_event_type) VALUES (?,?,'claude','old-provider-session',1,2,'Stop')",
	).run(terminalId, workspaceId);
	db.exec(
		"INSERT INTO host_settings(id,default_claude_config_dir) VALUES (1,'/old/provider-auth')",
	);
	db.exec(
		"INSERT INTO host_agent_configs(id,preset_id,label,command,prompt_transport,display_order,env_json,created_at,updated_at) VALUES ('unsafe','claude','Unsafe','mcp-relay','args',1,'{\"TOKEN\":\"never-copy\"}',1,1)",
	);
	const chat = new Database(join(source, "chat.db"));
	chat
		.prepare(
			"INSERT INTO chat_sessions_local(session_id,scope_id,harness,harness_session_id,epoch,status,updated_at) VALUES (?,?,'claude-code','provider-chat-id','epoch','running',1)",
		)
		.run(sessionId, workspaceId);
	chat
		.prepare(
			"INSERT INTO chat_journal(session_id,epoch,seq,ts,event_json) VALUES (?,'epoch',1,1,?)",
		)
		.run(
			sessionId,
			JSON.stringify({
				type: "turn",
				turn: { id: "turn", status: "running", startedAtMs: 1 },
			}),
		);
	chat.close(true);
	db.close(true);
	return {
		root,
		source,
		home,
		configPath,
		namespaceId,
		projectId,
		workspaceId,
		terminalId,
		sessionId,
		repo,
		worktree,
	};
}
function fingerprint(source: string) {
	return readdirSync(source)
		.filter((name) => /\.db(?:-wal|-shm)?$/.test(name))
		.sort()
		.map((name) => [
			name,
			createHash("sha256")
				.update(readFileSync(join(source, name)))
				.digest("hex"),
		]);
}
const dependencies = {
	openDatabase,
	initializeDatabase,
	probeWriters: async () => [] as number[],
};

test("fixture close finalizes prepared statements before source fingerprints are captured", () => {
	const root = mkdtempSync(join(tmpdir(), "legacy-fixture-close-"));
	temporary.push(root);
	const db = openDatabase(join(root, "host.db"), false);
	db.exec(
		"PRAGMA journal_mode=WAL; CREATE TABLE source_data(value TEXT); INSERT INTO source_data VALUES ('legacy fixture')",
	);
	const statement = db.prepare("SELECT value FROM source_data");
	statement.get();
	db.close();
	const closedFingerprint = fingerprint(root);
	(statement as unknown as { finalize(): void }).finalize();
	expect(fingerprint(root)).toEqual(closedFingerprint);
	expect(() => statement.get()).toThrow();
});

test("offline import preserves identities, real paths and history, while excluding executable account configuration", async () => {
	const f = await fixture();
	const before = fingerprint(f.source);
	const result = await importLegacyNamespace(
		{ sourceNamespaceDir: f.source, targetConfigPath: f.configPath },
		dependencies,
	);
	expect(result).toMatchObject({
		sourceNamespace: "old-org",
		targetNamespace: f.namespaceId,
		projects: 1,
		workspaces: 1,
		terminals: 1,
		chats: 1,
	});
	const target = join(f.home, "host", f.namespaceId);
	const db = new Database(join(target, "host.db"), { readonly: true });
	expect(db.prepare("SELECT id,repo_path FROM projects").get()).toEqual({
		id: f.projectId,
		repo_path: f.repo,
	});
	expect(
		db
			.prepare("SELECT id,worktree_path,created_by_user_id FROM workspaces")
			.get(),
	).toEqual({
		id: f.workspaceId,
		worktree_path: f.worktree,
		created_by_user_id: "old-actor",
	});
	expect(db.prepare("SELECT id,status FROM terminal_sessions").get()).toEqual({
		id: f.terminalId,
		status: "exited",
	});
	expect(
		db
			.prepare(
				"SELECT agent_session_id,end_reason FROM terminal_agent_bindings",
			)
			.get(),
	).toEqual({
		agent_session_id: "old-provider-session",
		end_reason: "terminal-exited",
	});
	expect(
		db.prepare("SELECT count(*) AS count FROM host_agent_configs").get(),
	).toEqual({ count: 0 });
	expect(
		db.prepare("SELECT default_claude_config_dir FROM host_settings").get(),
	).toBeNull();
	db.close(true);
	const chat = new Database(join(target, "chat.db"), { readonly: true });
	expect(
		chat
			.prepare(
				"SELECT session_id,harness_session_id,status FROM chat_sessions_local",
			)
			.get(),
	).toEqual({
		session_id: f.sessionId,
		harness_session_id: "provider-chat-id",
		status: "offline",
	});
	const events = chat
		.prepare("SELECT seq,event_json FROM chat_journal ORDER BY seq")
		.all() as { seq: number; event_json: string }[];
	expect(events[0]?.seq).toBe(1);
	expect(
		events.some(
			(row) => JSON.parse(row.event_json).turn?.status === "interrupted",
		),
	).toBe(true);
	chat.close(true);
	expect(fingerprint(f.source)).toEqual(before);
	expect(JSON.parse(readFileSync(result.journalPath, "utf8"))).toMatchObject({
		phase: "completed",
		sourceNamespace: "old-org",
		targetNamespace: f.namespaceId,
	});
	expect(readdirSync(target).sort()).toEqual(["chat.db", "host.db"]);
});

test("live source writers and daemon processes are refused before publishing", async () => {
	const f = await fixture();
	await expect(
		importLegacyNamespace(
			{ sourceNamespaceDir: f.source, targetConfigPath: f.configPath },
			{ ...dependencies, probeWriters: async () => [1234] },
		),
	).rejects.toThrow("writer");
	writeFileSync(
		join(f.source, "pty-daemon-manifest.json"),
		JSON.stringify({ pid: process.pid }),
		{ mode: 0o600 },
	);
	await expect(
		importLegacyNamespace(
			{ sourceNamespaceDir: f.source, targetConfigPath: f.configPath },
			dependencies,
		),
	).rejects.toThrow("process");
	expect(existsSync(join(f.home, "host", f.namespaceId))).toBe(false);
});

test("a stopped target containing any data is never overwritten", async () => {
	const f = await fixture();
	const target = join(f.home, "host", f.namespaceId);
	mkdirSync(target, { recursive: true });
	writeFileSync(join(target, "keep"), "existing");
	await expect(
		importLegacyNamespace(
			{ sourceNamespaceDir: f.source, targetConfigPath: f.configPath },
			dependencies,
		),
	).rejects.toThrow("empty");
	expect(readFileSync(join(target, "keep"), "utf8")).toBe("existing");
});

test("an initialized but resource-empty target can be replaced and its seeds roll back on failure", async () => {
	const f = await fixture();
	const target = join(f.home, "host", f.namespaceId);
	mkdirSync(target, { recursive: true, mode: 0o700 });
	await initializeDatabase("host", join(target, "host.db"));
	await initializeDatabase("chat", join(target, "chat.db"));
	const before = fingerprint(target);
	await expect(
		importLegacyNamespace(
			{ sourceNamespaceDir: f.source, targetConfigPath: f.configPath },
			{
				...dependencies,
				beforePublish: () => {
					throw new Error("fail empty seed");
				},
			},
		),
	).rejects.toThrow("fail empty seed");
	expect(fingerprint(target)).toEqual(before);
	const result = await importLegacyNamespace(
		{ sourceNamespaceDir: f.source, targetConfigPath: f.configPath },
		dependencies,
	);
	expect(result.projects).toBe(1);
});

test("unsupported v1 local.db and unverified writer checks fail closed", async () => {
	const f = await fixture();
	rmSync(join(f.source, "host.db"));
	writeFileSync(join(f.source, "local.db"), "legacy v1");
	await expect(
		importLegacyNamespace(
			{ sourceNamespaceDir: f.source, targetConfigPath: f.configPath },
			dependencies,
		),
	).rejects.toThrow();
	const another = await fixture();
	await expect(
		importLegacyNamespace(
			{
				sourceNamespaceDir: another.source,
				targetConfigPath: another.configPath,
			},
			{
				...dependencies,
				probeWriters: async () => {
					throw new Error("Cannot verify writers");
				},
			},
		),
	).rejects.toThrow("verify writers");
});

async function v1Fixture() {
	const f = await fixture();
	for (const name of readdirSync(f.source)) rmSync(join(f.source, name));
	const db = new Database(join(f.source, "local.db"));
	const worktreeId = randomUUID();
	db.exec(
		"CREATE TABLE projects(id TEXT PRIMARY KEY,main_repo_path TEXT,name TEXT,created_at INTEGER); CREATE TABLE worktrees(id TEXT PRIMARY KEY,project_id TEXT,path TEXT); CREATE TABLE workspaces(id TEXT PRIMARY KEY,project_id TEXT,worktree_id TEXT,type TEXT,branch TEXT,name TEXT,created_at INTEGER,updated_at INTEGER); CREATE TABLE settings(token TEXT)",
	);
	db.prepare("INSERT INTO projects VALUES (?,?,?,1)").run(
		f.projectId,
		f.repo,
		"v1 project",
	);
	db.prepare("INSERT INTO worktrees VALUES (?,?,?)").run(
		worktreeId,
		f.projectId,
		f.worktree,
	);
	db.prepare(
		"INSERT INTO workspaces VALUES (?,?,?,'worktree','main','v1 workspace',1,2)",
	).run(f.workspaceId, f.projectId, worktreeId);
	db.exec("INSERT INTO settings VALUES ('never-copy')");
	db.close(true);
	writeFileSync(
		join(f.source, "app-state.json"),
		JSON.stringify({
			tabsState: {
				tabs: [{ id: "tab", workspaceId: f.workspaceId }],
				panes: {
					[f.terminalId]: {
						id: f.terminalId,
						tabId: "tab",
						type: "terminal",
						cwd: f.worktree,
					},
				},
			},
			v1AgentSessions: {
				[f.terminalId]: {
					agentId: "codex",
					agentSessionId: "retained-v1-session",
					prompted: true,
					updatedAt: 2,
					token: "never-copy",
				},
			},
		}),
		{ mode: 0o600 },
	);
	const history = join(
		f.source,
		"terminal-history",
		f.workspaceId,
		f.terminalId,
	);
	mkdirSync(history, { recursive: true, mode: 0o700 });
	const metadata = JSON.stringify({
		cwd: f.worktree,
		cols: 80,
		rows: 24,
		startedAt: "2026-01-01T00:00:00.000Z",
	});
	writeFileSync(join(history, "meta.json"), metadata, { mode: 0o600 });
	writeFileSync(join(history, "scrollback.bin"), "historical terminal output", {
		mode: 0o600,
	});
	return { ...f, metadata };
}

test("offline v1 import publishes preserved UUIDs, static history and session captures without legacy settings or execution", async () => {
	const f = await v1Fixture();
	const before = fingerprint(f.source),
		stateBefore = readFileSync(join(f.source, "app-state.json"));
	const result = await importLegacyNamespace(
		{ sourceNamespaceDir: f.source, targetConfigPath: f.configPath },
		dependencies,
	);
	expect(result).toMatchObject({
		projects: 1,
		workspaces: 1,
		terminals: 1,
		chats: 0,
	});
	const target = join(f.home, "host", f.namespaceId);
	const db = new Database(join(target, "host.db"), { readonly: true });
	expect(
		db.prepare("SELECT id,created_by_user_id FROM workspaces").get(),
	).toEqual({ id: f.workspaceId, created_by_user_id: null });
	expect(db.prepare("SELECT id,status FROM terminal_sessions").get()).toEqual({
		id: f.terminalId,
		status: "exited",
	});
	expect(
		db.prepare("SELECT agent_session_id FROM terminal_agent_bindings").get(),
	).toEqual({ agent_session_id: "retained-v1-session" });
	db.close(true);
	expect(
		readFileSync(
			join(target, "legacy-history", f.workspaceId, f.terminalId, "meta.json"),
			"utf8",
		),
	).toBe(f.metadata);
	expect(
		readFileSync(
			join(
				target,
				"legacy-history",
				f.workspaceId,
				f.terminalId,
				"scrollback.bin",
			),
			"utf8",
		),
	).toBe("historical terminal output");
	expect(
		readFileSync(
			join(
				target,
				"legacy-history",
				f.workspaceId,
				f.terminalId,
				"agent-session.json",
			),
			"utf8",
		),
	).not.toContain("never-copy");
	expect(fingerprint(f.source)).toEqual(before);
	expect(readFileSync(join(f.source, "app-state.json"))).toEqual(stateBefore);
	expect(existsSync(join(f.home, "state", "disabled"))).toBe(true);
	expect(existsSync(join(f.home, "state", "endpoint.json"))).toBe(false);
});

test("v1 live terminal-host and a recent terminal spawn lock fail closed", async () => {
	const f = await v1Fixture();
	writeFileSync(join(f.source, "terminal-host.pid"), String(process.pid), {
		mode: 0o600,
	});
	await expect(
		importLegacyNamespace(
			{ sourceNamespaceDir: f.source, targetConfigPath: f.configPath },
			dependencies,
		),
	).rejects.toThrow("legacy process");
	rmSync(join(f.source, "terminal-host.pid"));
	writeFileSync(
		join(f.source, "terminal-host.spawn.lock"),
		String(Date.now()),
		{ mode: 0o600 },
	);
	await expect(
		importLegacyNamespace(
			{ sourceNamespaceDir: f.source, targetConfigPath: f.configPath },
			dependencies,
		),
	).rejects.toThrow("spawn");
});

test("a closed v1 pane preserves its historical provider capture without inventing a terminal row", async () => {
	const f = await v1Fixture();
	const statePath = join(f.source, "app-state.json");
	const state = JSON.parse(readFileSync(statePath, "utf8"));
	state.tabsState.panes = {};
	writeFileSync(statePath, JSON.stringify(state), { mode: 0o600 });
	const result = await importLegacyNamespace(
		{ sourceNamespaceDir: f.source, targetConfigPath: f.configPath },
		dependencies,
	);
	expect(result.terminals).toBe(0);
	const archive = JSON.parse(
		readFileSync(
			join(
				f.home,
				"host",
				f.namespaceId,
				"legacy-history",
				f.workspaceId,
				f.terminalId,
				"agent-session.json",
			),
			"utf8",
		),
	);
	expect(archive.agentSessionId).toBe("retained-v1-session");
	expect(archive.token).toBeUndefined();
});

test("conflicting real repository paths reject the whole import", async () => {
	const f = await fixture();
	const source = new Database(join(f.source, "host.db"));
	source
		.prepare(
			"INSERT INTO projects(id,repo_path,name,created_at) VALUES (?,?,?,1)",
		)
		.run(randomUUID(), f.repo, "conflict");
	source.close(true);
	const before = fingerprint(f.source);
	await expect(
		importLegacyNamespace(
			{ sourceNamespaceDir: f.source, targetConfigPath: f.configPath },
			dependencies,
		),
	).rejects.toThrow("conflict");
	expect(existsSync(join(f.home, "host", f.namespaceId))).toBe(false);
	expect(fingerprint(f.source)).toEqual(before);
});

test("multiple local workspaces of one project preserve their shared primary checkout", async () => {
	const f = await fixture();
	const source = new Database(join(f.source, "host.db"));
	const ids = [randomUUID(), randomUUID()];
	for (const [index, id] of ids.entries())
		source
			.prepare(
				"INSERT INTO workspaces(id,project_id,worktree_path,branch,name,type,created_at) VALUES (?,?,?,'main',?,'local',1)",
			)
			.run(id, f.projectId, f.repo, `Local ${index}`);
	source.close(true);
	const result = await importLegacyNamespace(
		{ sourceNamespaceDir: f.source, targetConfigPath: f.configPath },
		dependencies,
	);
	expect(result.workspaces).toBe(3);
	const target = new Database(join(f.home, "host", f.namespaceId, "host.db"), {
		readonly: true,
	});
	expect(
		target
			.prepare(
				"SELECT id,worktree_path FROM workspaces WHERE type='local' ORDER BY name",
			)
			.all(),
	).toEqual(ids.map((id) => ({ id, worktree_path: f.repo })));
	target.close(true);
});

test("archived workspaces and deleted projects retain identities when active rows reuse their paths", async () => {
	const f = await fixture();
	const source = new Database(join(f.source, "host.db"));
	const deletedProject = randomUUID(),
		archivedWorkspace = randomUUID();
	source
		.prepare(
			"INSERT INTO projects(id,repo_path,name,created_at,deleted_at) VALUES (?,?,?,1,2)",
		)
		.run(deletedProject, f.repo, "Deleted");
	source
		.prepare(
			"INSERT INTO workspaces(id,project_id,worktree_path,branch,name,created_at,archived_at) VALUES (?,?,?,'old','Archived',1,2)",
		)
		.run(archivedWorkspace, f.projectId, f.worktree);
	source.close(true);
	const result = await importLegacyNamespace(
		{ sourceNamespaceDir: f.source, targetConfigPath: f.configPath },
		dependencies,
	);
	expect(result.projects).toBe(2);
	expect(result.workspaces).toBe(2);
});

test("failure before atomic publish keeps source and target intact with a rollback journal", async () => {
	const f = await fixture();
	const before = fingerprint(f.source);
	await expect(
		importLegacyNamespace(
			{ sourceNamespaceDir: f.source, targetConfigPath: f.configPath },
			{
				...dependencies,
				beforePublish: () => {
					throw new Error("injected publication failure");
				},
			},
		),
	).rejects.toThrow("injected publication failure");
	expect(existsSync(join(f.home, "host", f.namespaceId))).toBe(false);
	expect(fingerprint(f.source)).toEqual(before);
	const journals = readdirSync(join(f.home, "state")).filter(
		(name) => name.startsWith("legacy-import-") && name.endsWith(".json"),
	);
	expect(
		JSON.parse(
			readFileSync(join(f.home, "state", journals[0] ?? "missing"), "utf8"),
		).phase,
	).toBe("rolled-back");
	expect(existsSync(join(f.home, "state", "legacy-import.lock"))).toBe(false);
});

test("WAL changes are included without touching source files, and pending chat actions become inert history", async () => {
	const f = await fixture();
	const wal = new Database(join(f.source, "host.db"));
	wal.exec("PRAGMA journal_mode=WAL");
	wal.prepare("UPDATE projects SET name='In WAL' WHERE id=?").run(f.projectId);
	const chat = new Database(join(f.source, "chat.db"));
	const pending = [
		{
			type: "item",
			turnId: "turn",
			item: {
				id: "queued",
				kind: "user_message",
				queued: true,
				content: [{ type: "text", text: "never execute" }],
				startedAtMs: 1,
			},
		},
		{
			type: "item",
			turnId: "turn",
			item: {
				id: "tool",
				kind: "tool_call",
				title: "Tool",
				toolKind: "execute",
				toolName: "shell",
				status: "running",
				content: [],
				startedAtMs: 1,
			},
		},
		{
			type: "item",
			turnId: "turn",
			item: {
				id: "approval",
				kind: "approval_request",
				title: "Approve",
				requestId: "request",
				options: [],
				status: "pending",
				startedAtMs: 1,
			},
		},
	];
	for (const [index, event] of pending.entries())
		chat
			.prepare(
				"INSERT INTO chat_journal(session_id,epoch,seq,ts,event_json) VALUES (?,'epoch',?,1,?)",
			)
			.run(f.sessionId, index + 2, JSON.stringify(event));
	chat.exec("UPDATE chat_sessions_local SET queued_count=1");
	chat.close(true);
	const before = fingerprint(f.source);
	try {
		await importLegacyNamespace(
			{ sourceNamespaceDir: f.source, targetConfigPath: f.configPath },
			dependencies,
		);
		expect(fingerprint(f.source)).toEqual(before);
		const target = new Database(
			join(f.home, "host", f.namespaceId, "host.db"),
			{ readonly: true },
		);
		expect(target.prepare("SELECT name FROM projects").get()).toEqual({
			name: "In WAL",
		});
		target.close(true);
		const imported = new Database(
			join(f.home, "host", f.namespaceId, "chat.db"),
			{ readonly: true },
		);
		expect(
			imported
				.prepare("SELECT status,queued_count FROM chat_sessions_local")
				.get(),
		).toEqual({ status: "offline", queued_count: 0 });
		const events = (
			imported
				.prepare("SELECT event_json FROM chat_journal ORDER BY seq")
				.all() as { event_json: string }[]
		).map((row) => JSON.parse(row.event_json));
		expect(
			events.some(
				(event) => event.item?.id === "queued" && event.item.discarded === true,
			),
		).toBe(true);
		expect(
			events.some(
				(event) =>
					event.item?.id === "tool" && event.item.status === "canceled",
			),
		).toBe(true);
		expect(
			events.some(
				(event) =>
					event.item?.id === "approval" && event.item.status === "stale",
			),
		).toBe(true);
		imported.close(true);
	} finally {
		wal.close(true);
	}
});

test("publication failure restores an existing resource-empty target", async () => {
	const f = await fixture();
	const target = join(f.home, "host", f.namespaceId);
	mkdirSync(target, { recursive: true, mode: 0o700 });
	await initializeDatabase("host", join(target, "host.db"));
	const before = fingerprint(target);
	await expect(
		importLegacyNamespace(
			{ sourceNamespaceDir: f.source, targetConfigPath: f.configPath },
			{
				...dependencies,
				afterPublish: () => {
					throw new Error("published failure");
				},
			},
		),
	).rejects.toThrow("published failure");
	expect(fingerprint(target)).toEqual(before);
});

test("an incomplete rollback keeps its import lock and durable recovery phase", async () => {
	const f = await fixture();
	const target = join(f.home, "host", f.namespaceId);
	try {
		await expect(
			importLegacyNamespace(
				{ sourceNamespaceDir: f.source, targetConfigPath: f.configPath },
				{
					...dependencies,
					afterPublish: () => {
						chmodSync(target, 0);
						throw new Error("publication failed");
					},
				},
			),
		).rejects.toThrow();
		expect(existsSync(join(f.home, "state", "legacy-import.lock"))).toBe(true);
		const journalName = readdirSync(join(f.home, "state")).find((name) =>
			/^legacy-import-.*\.json$/.test(name),
		);
		expect(journalName).toBeDefined();
		expect(
			JSON.parse(
				readFileSync(join(f.home, "state", journalName ?? "missing"), "utf8"),
			).phase,
		).toBe("rolling-back");
	} finally {
		if (existsSync(target)) chmodSync(target, 0o700);
	}
});

test.each([
	"prepared",
	"publishing",
	"completed",
])("dead importer recovery handles %s without losing the prior namespace", async (phase) => {
	const f = await fixture();
	const importId = randomUUID();
	const target = join(f.home, "host", f.namespaceId);
	const stage = join(f.home, "host", `.legacy-import-${importId}`);
	const original = join(f.home, "host", `.legacy-original-${importId}`);
	mkdirSync(join(f.home, "host"), { mode: 0o700 });
	mkdirSync(stage, { mode: 0o700 });
	if (phase !== "prepared") {
		mkdirSync(original, { mode: 0o700 });
		writeFileSync(join(original, "prior"), "prior", { mode: 0o600 });
		mkdirSync(target, { mode: 0o700 });
		writeFileSync(join(target, "candidate"), "candidate", { mode: 0o600 });
		rmSync(stage, { recursive: true });
	} else {
		mkdirSync(target, { mode: 0o700 });
		writeFileSync(join(target, "prior"), "prior", { mode: 0o600 });
	}
	writeFileSync(
		join(f.home, "state", "legacy-import.lock"),
		JSON.stringify({ pid: 2147483647, importId }),
		{ mode: 0o600 },
	);
	writeFileSync(
		join(f.home, "state", `legacy-import-${importId}.json`),
		JSON.stringify({
			importId,
			pid: 2147483647,
			targetNamespace: f.namespaceId,
			targetPath: target,
			phase,
		}),
		{ mode: 0o600 },
	);
	recoverLegacyImport(f.configPath);
	expect(
		readFileSync(
			join(target, phase === "completed" ? "candidate" : "prior"),
			"utf8",
		),
	).toBe(phase === "completed" ? "candidate" : "prior");
	expect(existsSync(stage)).toBe(false);
	expect(existsSync(original)).toBe(false);
	expect(existsSync(join(f.home, "state", "legacy-import.lock"))).toBe(false);
});

test("recovery after a second crash preserves an already restored prior target", async () => {
	const f = await fixture();
	const importId = randomUUID();
	const target = join(f.home, "host", f.namespaceId);
	mkdirSync(target, { recursive: true, mode: 0o700 });
	writeFileSync(join(target, "prior"), "keep restored prior data", {
		mode: 0o600,
	});
	writeFileSync(
		join(f.home, "state", "legacy-import.lock"),
		JSON.stringify({ pid: 2147483647, importId }),
		{ mode: 0o600 },
	);
	writeFileSync(
		join(f.home, "state", `legacy-import-${importId}.json`),
		JSON.stringify({
			importId,
			pid: 2147483647,
			targetNamespace: f.namespaceId,
			targetPath: target,
			phase: "publishing",
			hadOriginal: true,
		}),
		{ mode: 0o600 },
	);
	recoverLegacyImport(f.configPath);
	expect(readFileSync(join(target, "prior"), "utf8")).toBe(
		"keep restored prior data",
	);
});

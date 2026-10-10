import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
	chmodSync,
	closeSync,
	constants,
	existsSync,
	fstatSync,
	fsyncSync,
	lstatSync,
	mkdirSync,
	openSync,
	readdirSync,
	readFileSync,
	realpathSync,
	renameSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import {
	basename,
	dirname,
	isAbsolute,
	join,
	relative,
	resolve,
} from "node:path";
import { durableEventSchema } from "@superset/chat/protocol";
import { type DirectConfig, loadDirectConfig } from "./config";
import {
	type LegacyV1Rejection,
	mapLegacyV1Snapshot,
	stageLegacyV1History,
} from "./legacy-v1";
import { acquireDirectProcessLock } from "./process-lock";

type Row = Record<string, string | number | null>;
export interface ImportDatabase {
	exec(sql: string): unknown;
	prepare(sql: string): {
		all(...values: unknown[]): unknown[];
		get(...values: unknown[]): unknown;
		run(...values: unknown[]): unknown;
	};
	backup(destination: string): Promise<unknown>;
	close(): void;
}
export interface LegacyImportResult {
	sourceNamespace: string;
	targetNamespace: string;
	projects: number;
	workspaces: number;
	terminals: number;
	chats: number;
	journalPath: string;
	warnings?: string[];
}
interface Dependencies {
	openDatabase?: (path: string, readonly: boolean) => ImportDatabase;
	initializeDatabase?: (
		kind: "host" | "chat",
		path: string,
		migrationsFolder: string,
	) => Promise<void>;
	probeWriters?: (paths: string[]) => Promise<number[]>;
	beforePublish?: () => void;
	afterPublish?: () => void;
}
const HOST_TABLES = [
	"projects",
	"pull_requests",
	"workspaces",
	"terminal_sessions",
	"terminal_agent_bindings",
	"tag_folder_settings",
	"workspace_tags",
	"workspace_pull_requests",
];
const CHAT_TABLES = ["chat_sessions_local", "chat_journal"];
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
function present(path: string): boolean {
	try {
		lstatSync(path);
		return true;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
		throw error;
	}
}
function directory(path: string, create = false): void {
	if (create) mkdirSync(path, { recursive: true, mode: 0o700 });
	const stat = lstatSync(path);
	if (
		!stat.isDirectory() ||
		stat.isSymbolicLink() ||
		stat.uid !== process.getuid?.() ||
		(stat.mode & 0o077) !== 0
	)
		throw new Error("Import target must use owner-only directories");
}
function readRegular(path: string, maxBytes = 1024 * 1024 * 1024): Buffer {
	const fd = openSync(
		path,
		constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
	);
	try {
		const stat = fstatSync(fd);
		if (!stat.isFile() || stat.size > maxBytes)
			throw new Error("Import source must contain bounded regular files");
		return readFileSync(fd);
	} finally {
		closeSync(fd);
	}
}
function alive(pid: number): boolean {
	if (!Number.isInteger(pid) || pid < 1)
		throw new Error("Cannot verify legacy process identity");
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return (error as NodeJS.ErrnoException).code !== "ESRCH";
	}
}
/** No credential is sent to a legacy service. Unavailable process checks fail closed. */
export function probeLegacyWriters(paths: string[]): Promise<number[]> {
	const binary =
		process.platform === "darwin" ? "/usr/sbin/lsof" : "/usr/bin/lsof";
	return new Promise((resolveProbe, reject) => {
		execFile(
			binary,
			["-n", "-P", "-w", "-t", "--", ...paths],
			{ timeout: 5000, maxBuffer: 1024 * 1024, encoding: "utf8" },
			(error, stdout, stderr) => {
				if (
					error &&
					!((error as unknown as { code: number }).code === 1 && !stderr.trim())
				) {
					reject(
						new Error(
							"Cannot verify source writers; install system lsof and close the old application",
						),
					);
					return;
				}
				const pids = stdout.trim()
					? stdout.trim().split(/\s+/).map(Number)
					: [];
				if (pids.some((pid) => !Number.isInteger(pid) || pid < 1)) {
					reject(new Error("Cannot verify source writers"));
					return;
				}
				resolveProbe(pids.filter((pid) => pid !== process.pid));
			},
		);
	});
}
async function assertOffline(
	source: string,
	probe: (paths: string[]) => Promise<number[]>,
): Promise<void> {
	for (const name of ["manifest.json", "pty-daemon-manifest.json"]) {
		const path = join(source, name);
		if (present(path)) {
			const data = JSON.parse(
				readRegular(path, 64 * 1024).toString("utf8"),
			) as { pid?: number };
			if (data.pid === undefined || alive(data.pid))
				throw new Error(
					"A legacy process is active or unverifiable; finish agents and quit the old application completely",
				);
		}
	}
	if (present(join(source, "local.db"))) {
		const pidFile = join(source, "terminal-host.pid");
		if (present(pidFile)) {
			const pid = readRegular(pidFile, 64).toString("utf8").trim();
			if (!/^\d+$/.test(pid) || alive(Number(pid)))
				throw new Error(
					"A legacy process is active or unverifiable; quit the old terminal host before importing",
				);
		}
		const spawnLock = join(source, "terminal-host.spawn.lock");
		if (present(spawnLock)) {
			const timestamp = readRegular(spawnLock, 64).toString("utf8").trim();
			if (
				!/^\d+$/.test(timestamp) ||
				!Number.isSafeInteger(Number(timestamp)) ||
				Date.now() - Number(timestamp) < 10_000
			)
				throw new Error("A legacy terminal spawn is pending or unverifiable");
		}
	}
	const files = sourceFiles(source);
	const socket = join(source, "terminal-host.sock");
	if (present(socket)) files.push(socket);
	if ((await probe([source, ...files])).length)
		throw new Error(
			"A source writer or reader is active; close the old application before importing",
		);
}
function assertStopped(config: DirectConfig): void {
	const state = join(config.homeDir, "state");
	directory(config.homeDir);
	directory(state);
	if (!present(join(state, "disabled")))
		throw new Error("Stop the local backend before importing data");
	readRegular(join(state, "disabled"), 64 * 1024);
	if (present(join(state, "endpoint.json")))
		throw new Error(
			"The target backend is still active; Stop it before importing",
		);
}
function fingerprint(source: string): string {
	return JSON.stringify(
		sourceFiles(source)
			.sort()
			.map((path) => [
				relative(source, path),
				createHash("sha256").update(readRegular(path)).digest("hex"),
			]),
	);
}
function sourceFiles(source: string): string[] {
	const files = readdirSync(source)
		.filter((name) => /^(host|chat|local)\.db(?:-wal|-shm)?$/.test(name))
		.map((name) => join(source, name));
	if (!present(join(source, "local.db"))) return files;
	for (const name of [
		"app-state.json",
		"terminal-host.pid",
		"terminal-host.spawn.lock",
	])
		if (present(join(source, name))) files.push(join(source, name));
	const history = join(source, "terminal-history");
	if (!present(history)) return files;
	let bytes = 0;
	const walk = (path: string, depth: number) => {
		const stat = lstatSync(path);
		if (stat.isSymbolicLink() || stat.uid !== process.getuid?.())
			throw new Error("Legacy history must use owned real paths");
		if (stat.isDirectory()) {
			if (depth > 2)
				throw new Error("Unsupported legacy history directory layout");
			for (const name of readdirSync(path)) walk(join(path, name), depth + 1);
		} else {
			if (
				!stat.isFile() ||
				!/^(meta\.json|scrollback\.bin)$/.test(basename(path)) ||
				stat.size > 5 * 1024 * 1024
			)
				throw new Error("Unsupported or unsafe legacy history file");
			bytes += stat.size;
			files.push(path);
			if (files.length > 100_000 || bytes > 128 * 1024 * 1024)
				throw new Error("Legacy history exceeds the supported import capacity");
		}
	};
	walk(history, 0);
	return files;
}
function tables(db: ImportDatabase): string[] {
	return (
		db
			.prepare(
				"SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
			)
			.all() as { name: string }[]
	).map((row) => row.name);
}
function rows(db: ImportDatabase, table: string): Row[] {
	return db.prepare(`SELECT * FROM "${table}"`).all() as Row[];
}
function assertEmptyTarget(
	target: string,
	open: NonNullable<Dependencies["openDatabase"]>,
): void {
	if (!present(target)) return;
	const names = readdirSync(target);
	if (
		names.some(
			(name) =>
				!/^(host|chat|operations)\.db(?:-wal|-shm)?$/.test(name) &&
				!/^pty-daemon\.log(?:\.[0-9]+)?$/.test(name),
		)
	)
		throw new Error(
			"Import requires an empty target namespace; existing data is never overwritten",
		);
	directory(target);
	const seeds = new Set([
		"__drizzle_migrations",
		"host_settings",
		"host_agent_configs",
		"direct_maintenance",
		"direct_freeze",
	]);
	for (const name of ["host.db", "chat.db", "operations.db"]) {
		const path = join(target, name);
		if (!present(path)) continue;
		readRegular(path);
		const db = open(path, true);
		try {
			for (const table of tables(db))
				if (!seeds.has(table) && rows(db, table).length)
					throw new Error(
						"Import requires an empty target namespace; existing resources or operations cannot be merged",
					);
		} finally {
			db.close();
		}
	}
}
function verify(db: ImportDatabase): void {
	const check = db.prepare("PRAGMA integrity_check").all() as Record<
		string,
		string
	>[];
	if (
		check.length !== 1 ||
		Object.values(check[0] ?? {})[0] !== "ok" ||
		db.prepare("PRAGMA foreign_key_check").all().length
	)
		throw new Error(
			"Legacy database integrity or references cannot be verified",
		);
}
function checkIdsAndPaths(db: ImportDatabase): void {
	for (const table of ["projects", "workspaces", "terminal_sessions"])
		for (const row of rows(db, table))
			if (typeof row.id !== "string" || !UUID.test(row.id))
				throw new Error(`Legacy ${table} identity is invalid`);
	for (const [table, field] of [
		["projects", "repo_path"],
		["workspaces", "worktree_path"],
	] as const) {
		const seen = new Map<string, Row>();
		for (const row of rows(db, table)) {
			const value = row[field];
			if (typeof value !== "string" || !isAbsolute(value))
				throw new Error("Legacy repository/workspace paths must be absolute");
			if (
				(table === "projects" &&
					row.deleted_at !== null &&
					row.deleted_at !== undefined) ||
				(table === "workspaces" &&
					row.archived_at !== null &&
					row.archived_at !== undefined)
			)
				continue;
			const canonical = existsSync(value)
				? realpathSync(value)
				: resolve(value);
			const previous = seen.get(canonical);
			const sharedLocal =
				table === "workspaces" &&
				previous?.type === "local" &&
				row.type === "local" &&
				previous.project_id === row.project_id;
			if (previous && !sharedLocal)
				throw new Error(
					"Legacy path conflict; import sources into separate namespaces instead of merging",
				);
			seen.set(canonical, row);
		}
	}
}
function copyTables(
	source: ImportDatabase,
	destination: ImportDatabase,
	allowed: string[],
): void {
	const available = new Set(tables(source));
	destination.exec("PRAGMA foreign_keys=OFF; BEGIN IMMEDIATE");
	try {
		for (const table of allowed) {
			if (!available.has(table)) continue;
			const columns = (
				destination.prepare(`PRAGMA table_info("${table}")`).all() as {
					name: string;
				}[]
			).map((row) => row.name);
			for (const row of rows(source, table)) {
				const fields = columns.filter((column) => Object.hasOwn(row, column));
				destination
					.prepare(
						`INSERT INTO "${table}" (${fields.map((field) => `"${field}"`).join(",")}) VALUES (${fields.map(() => "?").join(",")})`,
					)
					.run(...fields.map((field) => row[field]));
			}
		}
		destination.exec("COMMIT; PRAGMA foreign_keys=ON");
	} catch (error) {
		destination.exec("ROLLBACK");
		throw error;
	}
}
function insertRows(
	destination: ImportDatabase,
	table: string,
	values: Row[],
): void {
	for (const row of values) {
		const fields = Object.keys(row);
		destination
			.prepare(
				`INSERT INTO "${table}" (${fields.map((field) => `"${field}"`).join(",")}) VALUES (${fields.map(() => "?").join(",")})`,
			)
			.run(...fields.map((field) => row[field]));
	}
}
function interruptChats(db: ImportDatabase): void {
	const now = Date.now();
	for (const session of rows(db, "chat_sessions_local")) {
		if (
			typeof session.session_id !== "string" ||
			!UUID.test(session.session_id)
		)
			throw new Error("Legacy chat identity is invalid");
		const history = db
			.prepare(
				"SELECT seq,event_json FROM chat_journal WHERE session_id=? AND epoch=? ORDER BY seq",
			)
			.all(session.session_id, session.epoch) as {
			seq: number;
			event_json: string;
		}[];
		const turns = new Map<
			string,
			Extract<
				ReturnType<typeof durableEventSchema.parse>,
				{ type: "turn" }
			>["turn"]
		>();
		const items = new Map<
			string,
			Extract<ReturnType<typeof durableEventSchema.parse>, { type: "item" }>
		>();
		let seq = 0;
		for (const row of history) {
			if (!Number.isInteger(row.seq) || row.seq !== seq + 1)
				throw new Error("Legacy chat journal sequence is inconsistent");
			seq = row.seq;
			const event = durableEventSchema.parse(JSON.parse(row.event_json));
			if (event.type === "turn") turns.set(event.turn.id, event.turn);
			if (event.type === "item") items.set(event.item.id, event);
		}
		const append = (event: unknown) => {
			const parsed = durableEventSchema.parse(event);
			db.prepare(
				"INSERT INTO chat_journal(session_id,epoch,seq,ts,event_json) VALUES (?,?,?,?,?)",
			).run(
				session.session_id,
				session.epoch,
				++seq,
				now,
				JSON.stringify(parsed),
			);
		};
		for (const turn of turns.values())
			if (turn.status === "running")
				append({
					type: "turn",
					turn: { ...turn, status: "interrupted", completedAtMs: now },
				});
		for (const event of items.values()) {
			const item = event.item;
			if (item.kind === "tool_call" && item.status === "running")
				append({
					...event,
					item: { ...item, status: "canceled", completedAtMs: now },
				});
			if (item.kind === "approval_request" && item.status === "pending")
				append({ ...event, item: { ...item, status: "stale" } });
			if (item.kind === "user_message" && item.queued === true)
				append({ ...event, item: { ...item, queued: false, discarded: true } });
		}
		append({
			type: "session",
			session: {
				status: "offline",
				harness: session.harness,
				...(session.harness_session_id
					? { harnessSessionId: session.harness_session_id }
					: {}),
				queuePaused: true,
				awaitingBackground: false,
				backgroundTasks: [],
			},
		});
		db.prepare(
			"UPDATE chat_sessions_local SET status='offline',queued_count=0,updated_at=? WHERE session_id=?",
		).run(now, session.session_id);
	}
}
function syncFile(path: string): void {
	const fd = openSync(
		path,
		constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
	);
	try {
		fsyncSync(fd);
	} finally {
		closeSync(fd);
	}
}
function syncTree(path: string): void {
	if (lstatSync(path).isDirectory())
		for (const name of readdirSync(path)) syncTree(join(path, name));
	syncFile(path);
}

/** A dead importer is recovered only from its validated, owner-local journal. */
export function recoverLegacyImport(targetConfigPath: string): void {
	const config = loadDirectConfig(targetConfigPath);
	assertStopped(config);
	const home = realpathSync(config.homeDir),
		state = join(home, "state");
	const lock = join(state, "legacy-import.lock");
	if (!present(lock)) return;
	const releaseRecovery = acquireDirectProcessLock(
		join(state, "legacy-import-recovery.lock"),
	);
	let releaseBackend: (() => void) | undefined;
	try {
		if (!present(lock)) return;
		const owner = JSON.parse(readRegular(lock, 64 * 1024).toString("utf8")) as {
			pid: number;
			importId: string;
		};
		if (!UUID.test(owner.importId) || alive(owner.pid))
			throw new Error(
				"An offline import is running or its owner cannot be verified",
			);
		releaseBackend = acquireDirectProcessLock(join(state, "backend.lock"));
		assertStopped(config);
		const hostRoot = join(home, "host"),
			target = join(hostRoot, config.namespaceId);
		directory(hostRoot);
		const journalPath = join(state, `legacy-import-${owner.importId}.json`);
		const stage = join(hostRoot, `.legacy-import-${owner.importId}`),
			original = join(hostRoot, `.legacy-original-${owner.importId}`);
		if (present(journalPath)) {
			const data = JSON.parse(
				readRegular(journalPath, 64 * 1024).toString("utf8"),
			) as {
				importId: string;
				pid: number;
				targetNamespace: string;
				targetPath: string;
				phase: string;
				hadOriginal?: boolean;
			};
			if (
				data.importId !== owner.importId ||
				data.pid !== owner.pid ||
				data.targetNamespace !== config.namespaceId ||
				data.targetPath !== target ||
				![
					"planned",
					"backed-up",
					"prepared",
					"publishing",
					"rolling-back",
					"completed",
					"rolled-back",
				].includes(data.phase)
			)
				throw new Error(
					"Import journal identity is invalid; explicit repair is required",
				);
			for (const path of [stage, original]) if (present(path)) directory(path);
			if (data.phase !== "completed" && data.phase !== "rolled-back") {
				const candidateMayExist =
					data.phase === "publishing" || data.phase === "rolling-back";
				if (data.hadOriginal === undefined) {
					if (present(original)) data.hadOriginal = true;
					else if (candidateMayExist && !present(stage) && present(target))
						throw new Error(
							"Import rollback state is ambiguous; preserving target data for explicit repair",
						);
					else data.hadOriginal = present(target);
				}
				const persist = () => {
					const temporary = `${journalPath}.tmp`;
					writeFileSync(temporary, JSON.stringify(data), { mode: 0o600 });
					syncFile(temporary);
					renameSync(temporary, journalPath);
					syncFile(state);
				};
				data.phase = "rolling-back";
				persist();
				if (present(original)) {
					if (present(target)) {
						directory(target);
						rmSync(target, { recursive: true });
					}
					renameSync(original, target);
				} else if (
					candidateMayExist &&
					data.hadOriginal === false &&
					!present(stage) &&
					present(target)
				) {
					directory(target);
					rmSync(target, { recursive: true });
				}
				rmSync(stage, { recursive: true, force: true });
				syncFile(hostRoot);
				data.phase = "rolled-back";
				persist();
			} else if (data.phase === "completed" && present(original))
				rmSync(original, { recursive: true });
			rmSync(stage, { recursive: true, force: true });
			syncFile(hostRoot);
			syncFile(state);
		} else if (present(stage) || present(original))
			throw new Error("Import journal is missing; explicit repair is required");
		rmSync(lock);
		syncFile(state);
	} finally {
		releaseBackend?.();
		releaseRecovery();
	}
}

/** Import one offline legacy source. SQLite never opens the real source, so even SHM stays unchanged. */
export async function importLegacyNamespace(
	options: { sourceNamespaceDir: string; targetConfigPath: string },
	dependencies: Dependencies = {},
): Promise<LegacyImportResult> {
	if (!process.getuid || process.getuid() < 1)
		throw new Error("Legacy import requires an ordinary OS user");
	if (
		!isAbsolute(options.sourceNamespaceDir) ||
		!isAbsolute(options.targetConfigPath)
	)
		throw new Error("Import paths must be absolute");
	const sourceStat = lstatSync(options.sourceNamespaceDir);
	if (
		!sourceStat.isDirectory() ||
		sourceStat.isSymbolicLink() ||
		sourceStat.uid !== process.getuid()
	)
		throw new Error("Select exactly one owned legacy source directory");
	const source = realpathSync(options.sourceNamespaceDir);
	const legacyV1 = present(join(source, "local.db"));
	if (legacyV1 === present(join(source, "host.db")))
		throw new Error(
			"Select one v2 namespace host.db directory or one v1 local.db directory; ambiguous or unsupported sources cannot be merged",
		);
	const config = loadDirectConfig(options.targetConfigPath);
	if (config.installationMode !== "local")
		throw new Error("Legacy import is supported only for the local backend");
	assertStopped(config);
	const home = realpathSync(config.homeDir);
	if (
		!relative(home, source).startsWith("..") ||
		!relative(source, home).startsWith("..")
	)
		throw new Error("Source and destination namespaces must be separate");
	const hostRoot = join(home, "host");
	directory(hostRoot, true);
	const target = join(hostRoot, config.namespaceId);
	const state = join(home, "state");
	const importId = randomUUID();
	recoverLegacyImport(options.targetConfigPath);
	const lock = join(state, "legacy-import.lock");
	writeFileSync(lock, JSON.stringify({ pid: process.pid, importId }), {
		mode: 0o600,
		flag: "wx",
	});
	const stage = join(hostRoot, `.legacy-import-${importId}`);
	const original = join(hostRoot, `.legacy-original-${importId}`);
	const journalPath = join(state, `legacy-import-${importId}.json`);
	let phase = "planned",
		published = false,
		displaced = false,
		resolved = false;
	const hadOriginal = present(target);
	let missingActors: string[] = [],
		historyUnavailable: LegacyV1Rejection[] = [];
	let releaseBackend: (() => void) | undefined;
	const journal = () => {
		const temporary = `${journalPath}.tmp`;
		writeFileSync(
			temporary,
			JSON.stringify({
				version: 1,
				importId,
				pid: process.pid,
				phase,
				hadOriginal,
				sourceFormat: legacyV1 ? "v1" : "v2",
				missingActors,
				historyUnavailable,
				sourcePath: source,
				sourceNamespace: basename(source),
				targetNamespace: config.namespaceId,
				targetPath: target,
			}),
			{ mode: 0o600 },
		);
		syncFile(temporary);
		renameSync(temporary, journalPath);
		syncFile(state);
	};
	try {
		releaseBackend = acquireDirectProcessLock(join(state, "backend.lock"));
		assertStopped(config);
		let openDb = dependencies.openDatabase;
		if (!openDb) {
			const Sqlite = (await import("better-sqlite3")).default;
			openDb = (path, readonly) =>
				new Sqlite(path, {
					readonly,
					fileMustExist: true,
				}) as unknown as ImportDatabase;
		}
		const initialize =
			dependencies.initializeDatabase ??
			(async (kind, path, migrationsFolder) => {
				if (kind === "host") {
					const { createDb } = await import("../db/db");
					createDb(path, migrationsFolder).$client.close();
				} else {
					const { createChatDb } = await import("@superset/chat-runtime");
					createChatDb({
						dataDir: dirname(path),
						migrationsFolder,
					}).$client.close();
				}
			});
		const probe = dependencies.probeWriters ?? probeLegacyWriters;
		await assertOffline(source, probe);
		assertEmptyTarget(target, openDb);
		if (
			present(target) &&
			(
				await probe([
					target,
					...readdirSync(target).map((name) => join(target, name)),
				])
			).length
		)
			throw new Error("A target writer is active");
		const sourceFingerprint = fingerprint(source);
		journal();
		directory(stage, true);
		const snapshots = join(stage, "snapshots");
		directory(snapshots, true);
		const backups = new Map<"host" | "chat", string>();
		for (const kind of ["host", "chat"] as const) {
			if (legacyV1 && kind === "chat") continue;
			const input = join(source, `${legacyV1 ? "local" : kind}.db`);
			if (!present(input)) continue;
			// Capture a quiescent DB plus WAL without opening the source. SQLite's
			// backup API builds the consistent snapshot from this owner-only copy.
			const copy = join(snapshots, `${kind}-source.db`);
			writeFileSync(copy, readRegular(input), { mode: 0o600, flag: "wx" });
			if (present(`${input}-wal`))
				writeFileSync(`${copy}-wal`, readRegular(`${input}-wal`), {
					mode: 0o600,
					flag: "wx",
				});
			const db = openDb(copy, true);
			const backup = join(snapshots, `${kind}.db`);
			try {
				const required = legacyV1
					? [
							["projects", "main_repo_path"],
							["workspaces", "worktree_id"],
							["worktrees", "path"],
						]
					: kind === "host"
						? [
								["projects", "repo_path"],
								["workspaces", "worktree_path"],
							]
						: [
								["chat_sessions_local", "session_id"],
								["chat_journal", "event_json"],
							];
				for (const [table, column] of required)
					if (
						!(
							db.prepare(`PRAGMA table_info("${table}")`).all() as {
								name: string;
							}[]
						).some((row) => row.name === column)
					)
						throw new Error(
							"Unsupported legacy database schema; no data was published",
						);
				await db.backup(backup);
				chmodSync(backup, 0o600);
			} finally {
				db.close();
			}
			if (!legacyV1)
				await initialize(
					kind,
					backup,
					kind === "host"
						? config.migrationsFolder
						: (config.chatMigrationsFolder ?? ""),
				);
			backups.set(kind, backup);
		}
		phase = "backed-up";
		journal();
		const hostBackupPath = backups.get("host");
		if (!hostBackupPath) throw new Error("The legacy host snapshot is missing");
		const hostBackup = openDb(hostBackupPath, true);
		const hostPath = join(stage, "host.db");
		await initialize("host", hostPath, config.migrationsFolder);
		chmodSync(hostPath, 0o600);
		const host = openDb(hostPath, false);
		let projects = 0,
			workspaces = 0,
			terminals = 0,
			chats = 0;
		try {
			verify(hostBackup);
			if (legacyV1) {
				const appStatePath = join(source, "app-state.json");
				const payload = mapLegacyV1Snapshot({
					database: hostBackup,
					...(present(appStatePath)
						? {
								appState: JSON.parse(
									readRegular(appStatePath, 16 * 1024 * 1024).toString("utf8"),
								),
							}
						: {}),
				});
				if (payload.rejections.length)
					throw new Error(
						`Legacy v1 entries conflict or cannot be verified: ${payload.rejections
							.map((item) => `${item.kind}:${item.id}:${item.reason}`)
							.slice(0, 10)
							.join(", ")}`,
					);
				missingActors = payload.missingActors;
				host.exec("BEGIN IMMEDIATE");
				try {
					insertRows(host, "projects", payload.projects);
					insertRows(host, "workspaces", payload.workspaces);
					insertRows(host, "terminal_sessions", payload.terminalSessions);
					insertRows(
						host,
						"terminal_agent_bindings",
						payload.terminalAgentBindings,
					);
					host.exec("COMMIT");
				} catch (error) {
					host.exec("ROLLBACK");
					throw error;
				}
				const history = stageLegacyV1History({
					sourceHistoryDir: join(source, "terminal-history"),
					archiveDir: join(stage, "legacy-history"),
					historyCopies: payload.historyCopies,
					agentCaptures: payload.agentCaptures,
				});
				historyUnavailable = history.rejections.filter(
					(item) => item.reason === "history-missing",
				);
				if (
					history.rejections.some((item) => item.reason !== "history-missing")
				)
					throw new Error(
						"Legacy v1 history cannot be verified; no data was published",
					);
			} else {
				checkIdsAndPaths(hostBackup);
				copyTables(hostBackup, host, HOST_TABLES);
			}
			const now = Date.now();
			host
				.prepare(
					"UPDATE terminal_sessions SET status='exited',ended_at=? WHERE status='active'",
				)
				.run(now);
			host
				.prepare(
					"UPDATE terminal_agent_bindings SET ended_at=?,end_reason='terminal-exited' WHERE ended_at IS NULL",
				)
				.run(now);
			verify(host);
			projects = rows(host, "projects").length;
			workspaces = rows(host, "workspaces").length;
			terminals = rows(host, "terminal_sessions").length;
		} finally {
			host.close();
			hostBackup.close();
		}
		const chatBackupPath = backups.get("chat");
		if (chatBackupPath) {
			const chatPath = join(stage, "chat.db");
			await initialize("chat", chatPath, config.chatMigrationsFolder ?? "");
			chmodSync(chatPath, 0o600);
			const sourceChat = openDb(chatBackupPath, true);
			const chat = openDb(chatPath, false);
			try {
				verify(sourceChat);
				const hostRead = openDb(hostPath, true);
				let workspaceIds: Set<unknown>;
				try {
					workspaceIds = new Set(
						rows(hostRead, "workspaces").map((row) => row.id),
					);
				} finally {
					hostRead.close();
				}
				for (const session of rows(sourceChat, "chat_sessions_local"))
					if (!workspaceIds.has(session.scope_id))
						throw new Error(
							"Legacy chat scope does not refer to an imported workspace",
						);
				copyTables(sourceChat, chat, CHAT_TABLES);
				interruptChats(chat);
				verify(chat);
				chats = rows(chat, "chat_sessions_local").length;
			} finally {
				chat.close();
				sourceChat.close();
			}
		}
		rmSync(snapshots, { recursive: true });
		await assertOffline(source, probe);
		if (fingerprint(source) !== sourceFingerprint)
			throw new Error(
				"Source data changed during import; no data was published",
			);
		assertStopped(config);
		assertEmptyTarget(target, openDb);
		dependencies.beforePublish?.();
		phase = "prepared";
		journal();
		syncTree(stage);
		phase = "publishing";
		journal();
		if (present(target)) {
			renameSync(target, original);
			displaced = true;
			syncFile(hostRoot);
		}
		renameSync(stage, target);
		published = true;
		syncFile(hostRoot);
		dependencies.afterPublish?.();
		phase = "completed";
		journal();
		if (displaced) {
			rmSync(original, { recursive: true });
			syncFile(hostRoot);
		}
		resolved = true;
		return {
			sourceNamespace: basename(source),
			targetNamespace: config.namespaceId,
			projects,
			workspaces,
			terminals,
			chats,
			journalPath,
			...(legacyV1
				? {
						warnings: [
							...(missingActors.length
								? [
										`${missingActors.length} imported workspace(s) have no provable legacy actor; their actor remains empty.`,
									]
								: []),
							...(historyUnavailable.length
								? [
										`${historyUnavailable.length} legacy terminal history file set(s) were unavailable; their session records were preserved.`,
									]
								: []),
							"Legacy terminal history is a static archive. Existing agents remain stopped, and provider sessions may require signing in again before resuming.",
						],
					}
				: {}),
		};
	} catch (error) {
		if (phase === "completed") throw error;
		phase = "rolling-back";
		journal();
		if (published) rmSync(target, { recursive: true, force: true });
		if (displaced && present(original)) renameSync(original, target);
		rmSync(stage, { recursive: true, force: true });
		syncFile(hostRoot);
		phase = "rolled-back";
		journal();
		resolved = true;
		throw error;
	} finally {
		releaseBackend?.();
		if (resolved) {
			rmSync(lock, { force: true });
			syncFile(state);
		}
	}
}

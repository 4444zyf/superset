import { createHash } from "node:crypto";
import {
	accessSync,
	chmodSync,
	constants,
	lstatSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { basename, isAbsolute, join, relative } from "node:path";
import {
	assertLegacySourceOffline,
	type ImportDatabase,
	legacySourceFingerprint,
	probeLegacyWriters,
	readLegacySourceFile,
} from "./legacy-import";
import { mapLegacyV1Snapshot } from "./legacy-v1";

export interface LegacySourcePreview {
	source: LegacySource;
	status: "ready" | "blocked";
	counts?: {
		projects: number;
		workspaces: number;
		terminals: number;
		chats: number;
	};
	reason?: string;
}
export interface LegacyConflict {
	kind:
		| "project-id"
		| "workspace-id"
		| "terminal-id"
		| "chat-id"
		| "repository-path"
		| "workspace-path";
	value: string;
	sourceIds: string[];
	entityIds: string[];
}
export interface LegacyImportPreview {
	sources: LegacySourcePreview[];
	conflicts: LegacyConflict[];
	conflictCount: number;
	conflictsTruncated: boolean;
	strategy: "separate-namespaces";
}

export async function previewLegacySources(
	options: { sources: LegacySource[]; stagingDirectory: string },
	dependencies: {
		openDatabase?: (path: string, readonly: boolean) => ImportDatabase;
		probeWriters?: (paths: string[]) => Promise<number[]>;
	} = {},
): Promise<LegacyImportPreview> {
	if (
		options.sources.length > 32 ||
		new Set(options.sources.map((source) => source.id)).size !==
			options.sources.length
	)
		throw new Error("Select at most 32 distinct legacy sources");
	const uid = process.getuid?.();
	if (!uid || !isAbsolute(options.stagingDirectory))
		throw new Error(
			"Private preview requires an ordinary OS user and absolute staging directory",
		);
	for (const source of options.sources) {
		const inside = relative(source.sourceDirectory, options.stagingDirectory);
		if (
			!inside ||
			(inside !== ".." && !inside.startsWith("../") && !isAbsolute(inside))
		)
			throw new Error(
				"Preview staging must be separate from all source directories",
			);
	}
	mkdirSync(options.stagingDirectory, { recursive: true, mode: 0o700 });
	const stagingStat = lstatSync(options.stagingDirectory);
	if (
		!stagingStat.isDirectory() ||
		stagingStat.isSymbolicLink() ||
		stagingStat.uid !== uid ||
		(stagingStat.mode & 0o077) !== 0
	)
		throw new Error("Preview staging must be an owner-only directory");
	let open = dependencies.openDatabase;
	if (!open) {
		const Sqlite = (await import("better-sqlite3")).default;
		open = (path, readonly) =>
			new Sqlite(path, {
				readonly,
				fileMustExist: true,
			}) as unknown as ImportDatabase;
	}
	const probe = dependencies.probeWriters ?? probeLegacyWriters;
	const result: LegacyImportPreview = {
		sources: [],
		conflicts: [],
		conflictCount: 0,
		conflictsTruncated: false,
		strategy: "separate-namespaces",
	};
	const evidence = new Map<string, LegacyConflict>();
	type Row = Record<string, unknown>;
	const rows = (db: ImportDatabase, table: string): Row[] => {
		if (
			!db
				.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?")
				.get(table)
		)
			return [];
		const values = db
			.prepare(`SELECT * FROM "${table}" LIMIT 100001`)
			.all() as Row[];
		if (values.length > 100_000)
			throw new Error("Legacy preview exceeds the supported resource count");
		return values;
	};
	for (const source of options.sources) {
		const stage = mkdtempSync(
			join(options.stagingDirectory, "legacy-preview-"),
		);
		const pending: Array<{
			kind: LegacyConflict["kind"];
			value: string;
			entityId: string;
		}> = [];
		try {
			const sourceStat = lstatSync(source.sourceDirectory);
			if (
				!sourceStat.isDirectory() ||
				sourceStat.isSymbolicLink() ||
				sourceStat.uid !== uid ||
				realpathSync(source.sourceDirectory) !== source.sourceDirectory ||
				source.id !== legacySourceId(source.sourceDirectory, source.format)
			)
				throw new Error("The discovered source identity changed");
			await assertLegacySourceOffline(source.sourceDirectory, probe);
			const before = legacySourceFingerprint(source.sourceDirectory);
			const snapshots = new Map<"host" | "chat", string>();
			for (const kind of ["host", "chat"] as const) {
				if (source.format === "v1" && kind === "chat") continue;
				const original = join(
					source.sourceDirectory,
					`${source.format === "v1" ? "local" : kind}.db`,
				);
				let stat: ReturnType<typeof lstatSync>;
				try {
					stat = lstatSync(original);
				} catch (error) {
					if (
						(error as NodeJS.ErrnoException).code === "ENOENT" &&
						kind === "chat"
					)
						continue;
					throw error;
				}
				if (!stat.isFile() || stat.isSymbolicLink() || stat.uid !== uid)
					throw new Error("The source database must be an owned regular file");
				const copy = join(stage, `${kind}-copy.db`);
				writeFileSync(copy, readLegacySourceFile(original), {
					mode: 0o600,
					flag: "wx",
				});
				try {
					const wal = readLegacySourceFile(`${original}-wal`);
					writeFileSync(`${copy}-wal`, wal, { mode: 0o600, flag: "wx" });
				} catch (error) {
					if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
				}
				const db = open(copy, true),
					backup = join(stage, `${kind}.db`);
				try {
					await db.backup(backup);
					chmodSync(backup, 0o600);
				} finally {
					db.close();
				}
				snapshots.set(kind, backup);
			}
			const hostPath = snapshots.get("host");
			if (!hostPath) throw new Error("The legacy host snapshot is missing");
			const db = open(hostPath, true);
			let projects: Row[], workspaces: Row[], terminals: Row[];
			try {
				if (source.format === "v1") {
					const state = join(source.sourceDirectory, "app-state.json");
					let appState: unknown;
					try {
						appState = JSON.parse(
							readLegacySourceFile(state, 16 * 1024 * 1024).toString("utf8"),
						);
					} catch (error) {
						if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
					}
					const mapped = mapLegacyV1Snapshot({ database: db, appState });
					if (mapped.rejections.length)
						throw new Error(
							`Unsupported v1 entries: ${mapped.rejections
								.slice(0, 8)
								.map((item) => item.reason)
								.join(", ")}`,
						);
					projects = mapped.projects;
					workspaces = mapped.workspaces;
					terminals = mapped.terminalSessions;
				} else {
					projects = rows(db, "projects");
					workspaces = rows(db, "workspaces");
					terminals = rows(db, "terminal_sessions");
					if (
						!(db.prepare('PRAGMA table_info("projects")').all() as Row[]).some(
							(row) => row.name === "repo_path",
						) ||
						!(
							db.prepare('PRAGMA table_info("workspaces")').all() as Row[]
						).some((row) => row.name === "worktree_path")
					)
						throw new Error("Unsupported v2 source schema");
				}
			} finally {
				db.close();
			}
			const addId = (
				kind: LegacyConflict["kind"],
				values: Row[],
				idField = "id",
			) => {
				for (const row of values) {
					const id = row[idField];
					if (
						typeof id !== "string" ||
						!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(
							id,
						)
					)
						throw new Error("A legacy resource UUID cannot be verified");
					pending.push({ kind, value: id.toLowerCase(), entityId: id });
				}
			};
			addId("project-id", projects);
			addId("workspace-id", workspaces);
			addId("terminal-id", terminals);
			for (const [kind, values, field, tombstone] of [
				["repository-path", projects, "repo_path", "deleted_at"],
				["workspace-path", workspaces, "worktree_path", "archived_at"],
			] as const)
				for (const row of values) {
					if (row[tombstone] != null) continue;
					const path = row[field];
					if (typeof path !== "string" || !isAbsolute(path))
						throw new Error("Legacy resource paths must be absolute");
					let canonical = path;
					try {
						canonical = realpathSync(path);
					} catch (error) {
						if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
					}
					pending.push({ kind, value: canonical, entityId: String(row.id) });
				}
			let chats = 0;
			const chatPath = snapshots.get("chat");
			if (chatPath) {
				const chat = open(chatPath, true);
				try {
					const sessions = rows(chat, "chat_sessions_local");
					addId("chat-id", sessions, "session_id");
					chats = sessions.length;
				} finally {
					chat.close();
				}
			}
			await assertLegacySourceOffline(source.sourceDirectory, probe);
			if (legacySourceFingerprint(source.sourceDirectory) !== before)
				throw new Error(
					"Source data changed during preview; close its writer and inspect again",
				);
			result.sources.push({
				source,
				status: "ready",
				counts: {
					projects: projects.length,
					workspaces: workspaces.length,
					terminals: terminals.length,
					chats,
				},
			});
			for (const item of pending) {
				const key = JSON.stringify([item.kind, item.value]);
				const current = evidence.get(key) ?? {
					kind: item.kind,
					value: item.value,
					sourceIds: [],
					entityIds: [],
				};
				if (!current.sourceIds.includes(source.id))
					current.sourceIds.push(source.id);
				if (!current.entityIds.includes(item.entityId))
					current.entityIds.push(item.entityId);
				evidence.set(key, current);
			}
		} catch (error) {
			result.sources.push({
				source,
				status: "blocked",
				reason: (error instanceof Error
					? error.message
					: "Legacy source cannot be verified"
				).slice(0, 512),
			});
		} finally {
			rmSync(stage, { recursive: true, force: true });
		}
	}
	const conflicts = [...evidence.values()].filter(
		(conflict) => conflict.sourceIds.length > 1,
	);
	result.conflictCount = conflicts.length;
	result.conflictsTruncated = conflicts.length > 100;
	result.conflicts = conflicts.slice(0, 100);
	return result;
}

export interface LegacySource {
	id: string;
	format: "v1" | "v2";
	sourceDirectory: string;
	sourceNamespace: string;
}
export interface LegacyDiscovery {
	sources: LegacySource[];
	issues: Array<{
		path: string;
		reason:
			| "symlink"
			| "foreign-owner"
			| "unreadable"
			| "not-directory"
			| "not-regular"
			| "limit";
	}>;
}

export function legacySourceId(
	sourceDirectory: string,
	format: "v1" | "v2",
): string {
	return createHash("sha256")
		.update(JSON.stringify([sourceDirectory, format]))
		.digest("hex");
}

/** Only known local homes are scanned; source databases are never opened. */
export function discoverLegacySources(options: {
	userHomeDir: string;
	uid?: number;
}): LegacyDiscovery {
	const uid = options.uid ?? process.getuid?.();
	if (uid === undefined || uid < 1 || !isAbsolute(options.userHomeDir))
		throw new Error(
			"Local discovery requires an ordinary OS user and absolute home",
		);
	const result: LegacyDiscovery = { sources: [], issues: [] };
	const inspect = (path: string, kind: "directory" | "file"): boolean => {
		try {
			const stat = lstatSync(path);
			let reason: LegacyDiscovery["issues"][number]["reason"] | undefined;
			if (stat.isSymbolicLink()) reason = "symlink";
			else if (stat.uid !== uid) reason = "foreign-owner";
			else if (kind === "directory" ? !stat.isDirectory() : !stat.isFile())
				reason = kind === "directory" ? "not-directory" : "not-regular";
			if (reason) {
				result.issues.push({ path, reason });
				return false;
			}
			accessSync(
				path,
				constants.R_OK | (kind === "directory" ? constants.X_OK : 0),
			);
			return true;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT")
				result.issues.push({ path, reason: "unreadable" });
			return false;
		}
	};
	const boundedNames = (path: string, maximum: number) => {
		const names = readdirSync(path).sort();
		if (names.length > maximum) result.issues.push({ path, reason: "limit" });
		return names.slice(0, maximum);
	};
	const add = (path: string, format: "v1" | "v2", database: string) => {
		if (!inspect(join(path, database), "file")) return;
		if (result.sources.length >= 128) {
			result.issues.push({ path, reason: "limit" });
			return;
		}
		const sourceDirectory = realpathSync(path);
		result.sources.push({
			id: legacySourceId(sourceDirectory, format),
			format,
			sourceDirectory,
			sourceNamespace: basename(path),
		});
	};
	if (!inspect(options.userHomeDir, "directory")) return result;
	const home = realpathSync(options.userHomeDir);
	const names = readdirSync(home)
		.filter((name) => name === ".superset" || name.startsWith(".superset-"))
		.sort();
	if (names.length > 32) result.issues.push({ path: home, reason: "limit" });
	for (const name of names.slice(0, 32)) {
		const legacyHome = join(home, name);
		if (!inspect(legacyHome, "directory")) continue;
		add(legacyHome, "v1", "local.db");
		const host = join(legacyHome, "host");
		if (!inspect(host, "directory")) continue;
		for (const namespace of boundedNames(host, 512)) {
			const directory = join(host, namespace);
			if (!inspect(directory, "directory")) continue;
			add(directory, "v2", "host.db");
		}
	}
	return result;
}

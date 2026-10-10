import {
	closeSync,
	constants,
	existsSync,
	fstatSync,
	lstatSync,
	mkdirSync,
	openSync,
	readdirSync,
	readSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { AGENT_IDENTITY_IDS } from "@superset/shared/agent-catalog";

export interface LegacyV1Database {
	prepare(sql: string): { all(): unknown[] };
}
export type LegacyV1Row = Record<string, string | number | null>;
export interface LegacyV1Rejection {
	kind:
		| "project"
		| "workspace"
		| "terminal"
		| "agent"
		| "history"
		| "app-state";
	id: string;
	reason: string;
}
export interface LegacyV1AgentCapture {
	agentId: string;
	agentSessionId: string;
	prompted: boolean;
	updatedAt: number;
	endedAt?: number;
}
export interface LegacyV1HistoryCopy {
	workspaceId: string;
	terminalId: string;
	cwd: string | null;
	agentCapture?: LegacyV1AgentCapture;
}
export interface LegacyV1Payload {
	projects: LegacyV1Row[];
	workspaces: LegacyV1Row[];
	terminalSessions: LegacyV1Row[];
	terminalAgentBindings: LegacyV1Row[];
	agentCaptures: Record<string, LegacyV1AgentCapture>;
	historyCopies: LegacyV1HistoryCopy[];
	rejections: LegacyV1Rejection[];
	missingActors: string[];
}
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const MAX_ROWS = 100_000;
const MAX_HISTORY_BYTES = 5 * 1024 * 1024;
const MAX_ARCHIVE_BYTES = 128 * 1024 * 1024;
type RecordValue = Record<string, unknown>;
function record(value: unknown): value is RecordValue {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
function timestamp(value: unknown): value is number {
	return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}
function uuid(value: unknown): value is string {
	return typeof value === "string" && UUID.test(value);
}
function text(value: unknown, maximum = 4096): value is string {
	return (
		typeof value === "string" &&
		value.length > 0 &&
		value.length <= maximum &&
		!value.includes("\0")
	);
}
function absolutePath(value: unknown): value is string {
	return text(value) && isAbsolute(value);
}
function agentCaptureFrom(value: unknown): LegacyV1AgentCapture | undefined {
	if (
		!record(value) ||
		typeof value.agentId !== "string" ||
		!AGENT_IDENTITY_IDS.some((agent) => agent === value.agentId) ||
		!text(value.agentSessionId, 1024) ||
		typeof value.prompted !== "boolean" ||
		!timestamp(value.updatedAt) ||
		(value.endedAt !== undefined && !timestamp(value.endedAt))
	)
		return undefined;
	return {
		agentId: value.agentId,
		agentSessionId: value.agentSessionId,
		prompted: value.prompted,
		updatedAt: value.updatedAt,
		...(value.endedAt === undefined ? {} : { endedAt: value.endedAt }),
	};
}
function tableRows(
	db: LegacyV1Database,
	table: string,
	required: string[],
): RecordValue[] {
	const columns = db.prepare(`PRAGMA table_info("${table}")`).all();
	if (
		required.some(
			(column) => !columns.some((row) => record(row) && row.name === column),
		)
	)
		throw new Error(`Unsupported legacy v1 ${table} schema`);
	const definitions = db
		.prepare(`SELECT type FROM sqlite_master WHERE name='${table}'`)
		.all();
	if (
		definitions.length !== 1 ||
		!record(definitions[0]) ||
		definitions[0].type !== "table"
	)
		throw new Error(`Legacy v1 ${table} must be a table`);
	const rows = db
		.prepare(`SELECT * FROM "${table}" LIMIT ${MAX_ROWS + 1}`)
		.all();
	if (rows.length > MAX_ROWS || rows.some((row) => !record(row)))
		throw new Error("Legacy v1 snapshot exceeds the supported row limit");
	return rows as RecordValue[];
}
function duplicatePaths(rows: LegacyV1Row[], field: string): Set<string> {
	const paths = new Map<string, LegacyV1Row[]>();
	for (const row of rows) {
		const path = String(row[field]);
		const canonical = existsSync(path) ? realpathSync(path) : resolve(path);
		const entries = paths.get(canonical) ?? [];
		entries.push(row);
		paths.set(canonical, entries);
	}
	return new Set(
		[...paths.values()]
			.filter(
				(entries) =>
					entries.length > 1 &&
					!(
						field === "worktree_path" &&
						entries.every(
							(row) =>
								row.type === "local" &&
								row.project_id === entries[0]?.project_id,
						)
					),
			)
			.flatMap((entries) => entries.map((row) => String(row.id))),
	);
}

export function mapLegacyV1Snapshot(options: {
	database: LegacyV1Database;
	appState?: unknown;
	importedAt?: number;
}): LegacyV1Payload {
	const importedAt = options.importedAt ?? Date.now();
	if (!timestamp(importedAt))
		throw new Error("Legacy import timestamp is invalid");
	const result: LegacyV1Payload = {
		projects: [],
		workspaces: [],
		terminalSessions: [],
		terminalAgentBindings: [],
		agentCaptures: {},
		historyCopies: [],
		rejections: [],
		missingActors: [],
	};
	const reject = (
		kind: LegacyV1Rejection["kind"],
		id: unknown,
		reason: string,
	) => {
		result.rejections.push({
			kind,
			id: typeof id === "string" ? id : "unknown",
			reason,
		});
	};
	const projects = tableRows(options.database, "projects", [
		"id",
		"main_repo_path",
		"name",
		"created_at",
	]);
	const workspaces = tableRows(options.database, "workspaces", [
		"id",
		"project_id",
		"worktree_id",
		"type",
		"branch",
		"name",
		"created_at",
		"updated_at",
	]);
	const worktrees = tableRows(options.database, "worktrees", [
		"id",
		"project_id",
		"path",
	]);
	for (const row of projects) {
		if (!uuid(row.id)) {
			reject("project", row.id, "invalid-uuid");
			continue;
		}
		if (
			!absolutePath(row.main_repo_path) ||
			!text(row.name) ||
			!timestamp(row.created_at)
		) {
			reject("project", row.id, "invalid-metadata");
			continue;
		}
		result.projects.push({
			id: row.id,
			repo_path: row.main_repo_path,
			name: row.name,
			created_at: row.created_at,
			updated_at: row.created_at,
			color:
				typeof row.color === "string" && /^#[a-f0-9]{6}$/i.test(row.color)
					? row.color
					: null,
			icon: row.hide_image === 1 ? "none" : null,
		});
	}
	const projectConflicts = duplicatePaths(result.projects, "repo_path");
	for (const id of projectConflicts) reject("project", id, "path-conflict");
	result.projects = result.projects.filter(
		(row) => !projectConflicts.has(String(row.id)),
	);
	const projectById = new Map(result.projects.map((row) => [row.id, row]));
	const worktreeById = new Map(worktrees.map((row) => [row.id, row]));
	for (const row of workspaces) {
		if (!uuid(row.id)) {
			reject("workspace", row.id, "invalid-uuid");
			continue;
		}
		const project = projectById.get(String(row.project_id));
		if (!project) {
			reject("workspace", row.id, "missing-project");
			continue;
		}
		if (row.deleting_at != null) {
			reject("workspace", row.id, "deletion-in-progress");
			continue;
		}
		if (
			!text(row.name) ||
			!text(row.branch) ||
			!timestamp(row.created_at) ||
			!timestamp(row.updated_at) ||
			(row.type !== "branch" && row.type !== "worktree")
		) {
			reject("workspace", row.id, "invalid-metadata");
			continue;
		}
		let path = project.repo_path;
		if (row.type === "worktree") {
			const worktree = worktreeById.get(row.worktree_id);
			if (
				!worktree ||
				worktree.project_id !== row.project_id ||
				!uuid(worktree.id) ||
				!absolutePath(worktree.path)
			) {
				reject("workspace", row.id, "missing-worktree");
				continue;
			}
			path = worktree.path;
		}
		result.workspaces.push({
			id: row.id,
			project_id: String(row.project_id),
			worktree_path: path ?? null,
			branch: row.branch,
			name: row.name,
			type: row.type === "branch" ? "local" : "worktree",
			created_by_user_id: null,
			created_at: row.created_at,
			updated_at: row.updated_at,
			last_activity_at: timestamp(row.last_opened_at)
				? row.last_opened_at
				: row.updated_at,
		});
	}
	const workspaceConflicts = duplicatePaths(result.workspaces, "worktree_path");
	for (const id of workspaceConflicts) reject("workspace", id, "path-conflict");
	result.workspaces = result.workspaces.filter(
		(row) => !workspaceConflicts.has(String(row.id)),
	);
	result.missingActors = result.workspaces.map((row) => String(row.id));
	if (options.appState === undefined) return result;
	if (!record(options.appState)) {
		reject("app-state", "app-state", "unsupported-state");
		return result;
	}
	const appState = options.appState;
	if (record(appState.v1AgentSessions)) {
		for (const [id, value] of Object.entries(appState.v1AgentSessions)) {
			if (!uuid(id)) {
				reject("agent", id, "invalid-uuid");
				continue;
			}
			const capture = agentCaptureFrom(value);
			if (!capture) {
				reject("agent", id, "invalid-session-metadata");
				continue;
			}
			result.agentCaptures[id] = capture;
		}
	} else if (appState.v1AgentSessions !== undefined)
		reject("app-state", "app-state", "unsupported-state");
	const layouts: unknown[] = [appState.tabsState];
	if (record(appState.tabsStateByWindow))
		layouts.push(...Object.values(appState.tabsStateByWindow));
	const panes = new Map<
		string,
		{ pane: RecordValue; workspaceIds: Set<string> }
	>();
	for (const layout of layouts) {
		if (
			!record(layout) ||
			!Array.isArray(layout.tabs) ||
			!record(layout.panes)
		) {
			if (layout !== undefined)
				reject("app-state", "app-state", "unsupported-state");
			continue;
		}
		if (
			layout.tabs.length > MAX_ROWS ||
			Object.keys(layout.panes).length > MAX_ROWS
		)
			throw new Error("Legacy v1 layout exceeds the supported row limit");
		const tabs = new Map<unknown, Set<string>>();
		for (const tab of layout.tabs.filter(record)) {
			const workspaces = tabs.get(tab.id) ?? new Set<string>();
			workspaces.add(
				typeof tab.workspaceId === "string" ? tab.workspaceId : "unknown",
			);
			tabs.set(tab.id, workspaces);
		}
		for (const [key, pane] of Object.entries(layout.panes)) {
			if (!record(pane) || pane.type !== "terminal") continue;
			if (!uuid(pane.id) || pane.id !== key) {
				reject("terminal", key, "invalid-uuid");
				continue;
			}
			const tabWorkspaces = tabs.get(pane.tabId) ?? new Set(["unknown"]);
			const existing = panes.get(pane.id) ?? {
				pane,
				workspaceIds: new Set<string>(),
			};
			for (const workspaceId of tabWorkspaces)
				existing.workspaceIds.add(workspaceId);
			panes.set(pane.id, existing);
		}
	}
	const workspaceIds = new Set(result.workspaces.map((row) => row.id));
	for (const [id, entry] of panes) {
		if (entry.workspaceIds.size !== 1) {
			reject("terminal", id, "workspace-conflict");
			continue;
		}
		const workspaceId = [...entry.workspaceIds][0];
		if (!workspaceId || !workspaceIds.has(workspaceId)) {
			reject("terminal", id, "missing-workspace");
			continue;
		}
		const agentCapture = result.agentCaptures[id];
		result.terminalSessions.push({
			id,
			origin_workspace_id: workspaceId,
			status: "exited",
			custom_title: text(entry.pane.userTitle) ? entry.pane.userTitle : null,
			created_at: agentCapture?.updatedAt ?? importedAt,
			ended_at: importedAt,
		});
		if (agentCapture)
			result.terminalAgentBindings.push({
				terminal_id: id,
				workspace_id: workspaceId,
				agent_id: agentCapture.agentId,
				agent_session_id: agentCapture.agentSessionId,
				started_at: agentCapture.updatedAt,
				last_event_at: agentCapture.updatedAt,
				last_event_type: "LegacyImport",
				ended_at: agentCapture.endedAt ?? importedAt,
				end_reason:
					agentCapture.endedAt === undefined ? "terminal-exited" : "detached",
				transcript_path: null,
			});
		const cwd = entry.pane.cwd ?? entry.pane.initialCwd;
		result.historyCopies.push({
			workspaceId,
			terminalId: id,
			cwd: absolutePath(cwd) ? cwd : null,
			...(agentCapture ? { agentCapture } : {}),
		});
	}
	return result;
}

function sourceDirectory(path: string): void {
	const stat = lstatSync(path);
	if (
		!stat.isDirectory() ||
		stat.isSymbolicLink() ||
		stat.uid !== process.getuid?.()
	)
		throw new Error("Legacy history must use owned real directories");
}
function privateDirectory(path: string): void {
	sourceDirectory(path);
	if ((lstatSync(path).mode & 0o077) !== 0)
		throw new Error("History archive must use private directories");
}
function readHistory(path: string, maximum: number): Buffer {
	const fd = openSync(
		path,
		constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
	);
	try {
		const stat = fstatSync(fd);
		if (
			!stat.isFile() ||
			stat.uid !== process.getuid?.() ||
			stat.size > maximum
		)
			throw new Error("Legacy history is not a bounded owned regular file");
		const buffer = Buffer.alloc(maximum + 1);
		let bytes = 0;
		while (bytes < buffer.length) {
			const count = readSync(fd, buffer, bytes, buffer.length - bytes, null);
			if (!count) break;
			bytes += count;
		}
		if (bytes > maximum)
			throw new Error("Legacy history exceeds its size limit");
		return buffer.subarray(0, bytes);
	} finally {
		closeSync(fd);
	}
}

export function stageLegacyV1History(options: {
	sourceHistoryDir: string;
	archiveDir: string;
	historyCopies: LegacyV1HistoryCopy[];
	agentCaptures?: Record<string, LegacyV1AgentCapture>;
}): { archives: LegacyV1HistoryCopy[]; rejections: LegacyV1Rejection[] } {
	if (!isAbsolute(options.sourceHistoryDir) || !isAbsolute(options.archiveDir))
		throw new Error("History archive paths must be absolute");
	if (options.historyCopies.length > MAX_ROWS)
		throw new Error("Legacy history exceeds the supported row limit");
	privateDirectory(dirname(options.archiveDir));
	const source = resolve(options.sourceHistoryDir),
		destination = resolve(options.archiveDir);
	const within = (base: string, path: string) => {
		const segment = relative(base, path);
		return !segment.startsWith("..") && !isAbsolute(segment);
	};
	if (within(source, destination) || within(destination, source))
		throw new Error("Source history and archive must be separate");
	mkdirSync(destination, { mode: 0o700 });
	const result: {
		archives: LegacyV1HistoryCopy[];
		rejections: LegacyV1Rejection[];
	} = { archives: [], rejections: [] };
	const copies = new Map(
		options.historyCopies.map((copy) => [
			`${copy.workspaceId}/${copy.terminalId}`,
			copy,
		]),
	);
	if (existsSync(source)) {
		sourceDirectory(source);
		for (const workspace of readdirSync(source, { withFileTypes: true })) {
			if (!workspace.isDirectory() && !workspace.isSymbolicLink()) continue;
			if (!uuid(workspace.name) || workspace.isSymbolicLink()) {
				result.rejections.push({
					kind: "history",
					id: workspace.name,
					reason: "unsafe-history",
				});
				continue;
			}
			const workspaceHistory = join(source, workspace.name);
			sourceDirectory(workspaceHistory);
			for (const terminal of readdirSync(workspaceHistory, {
				withFileTypes: true,
			})) {
				if (!terminal.isDirectory() && !terminal.isSymbolicLink()) continue;
				if (!uuid(terminal.name) || terminal.isSymbolicLink()) {
					result.rejections.push({
						kind: "history",
						id: terminal.name,
						reason: "unsafe-history",
					});
					continue;
				}
				const key = `${workspace.name}/${terminal.name}`;
				if (!copies.has(key))
					copies.set(key, {
						workspaceId: workspace.name,
						terminalId: terminal.name,
						cwd: null,
					});
				if (copies.size > MAX_ROWS)
					throw new Error("Legacy history exceeds the supported row limit");
			}
		}
	}
	const workspacesByTerminal = new Map<string, Set<string>>();
	for (const copy of copies.values()) {
		const workspaceIds =
			workspacesByTerminal.get(copy.terminalId) ?? new Set<string>();
		workspaceIds.add(copy.workspaceId);
		workspacesByTerminal.set(copy.terminalId, workspaceIds);
	}
	for (const [id, workspaceIds] of workspacesByTerminal)
		if (workspaceIds.size > 1) {
			result.rejections.push({
				kind: "history",
				id,
				reason: "workspace-conflict",
			});
			for (const workspaceId of workspaceIds)
				copies.delete(`${workspaceId}/${id}`);
		}
	let totalBytes = 0;
	for (const copy of copies.values()) {
		if (!uuid(copy.workspaceId) || !uuid(copy.terminalId))
			throw new Error("History archive identities must be UUIDs");
		const original = join(source, copy.workspaceId, copy.terminalId);
		const rawCapture =
			copy.agentCapture ?? options.agentCaptures?.[copy.terminalId];
		const agentCapture = agentCaptureFrom(rawCapture);
		if (rawCapture !== undefined && !agentCapture) {
			result.rejections.push({
				kind: "history",
				id: copy.terminalId,
				reason: "invalid-session-metadata",
			});
			continue;
		}
		let metadata: Buffer, scrollback: Buffer;
		try {
			sourceDirectory(source);
			sourceDirectory(join(source, copy.workspaceId));
			sourceDirectory(original);
			metadata = readHistory(join(original, "meta.json"), 64 * 1024);
			scrollback = readHistory(
				join(original, "scrollback.bin"),
				MAX_HISTORY_BYTES,
			);
			const parsed: unknown = JSON.parse(metadata.toString("utf8"));
			if (
				!record(parsed) ||
				!absolutePath(parsed.cwd) ||
				!timestamp(parsed.cols) ||
				parsed.cols < 1 ||
				!timestamp(parsed.rows) ||
				parsed.rows < 1 ||
				!text(parsed.startedAt) ||
				!Number.isFinite(Date.parse(parsed.startedAt)) ||
				(parsed.endedAt !== undefined &&
					(!text(parsed.endedAt) ||
						!Number.isFinite(Date.parse(parsed.endedAt)))) ||
				(parsed.exitCode !== undefined &&
					(typeof parsed.exitCode !== "number" ||
						!Number.isSafeInteger(parsed.exitCode)))
			)
				throw new Error("Invalid legacy history metadata");
			metadata = Buffer.from(
				JSON.stringify({
					cwd: parsed.cwd,
					cols: parsed.cols,
					rows: parsed.rows,
					startedAt: parsed.startedAt,
					...(parsed.endedAt === undefined ? {} : { endedAt: parsed.endedAt }),
					...(parsed.exitCode === undefined
						? {}
						: { exitCode: parsed.exitCode }),
				}),
			);
			if (totalBytes + metadata.length + scrollback.length > MAX_ARCHIVE_BYTES)
				throw new Error("History archive capacity exceeded");
		} catch (error) {
			result.rejections.push({
				kind: "history",
				id: copy.terminalId,
				reason:
					(error as NodeJS.ErrnoException).code === "ENOENT"
						? "history-missing"
						: "unsafe-history",
			});
			continue;
		}
		const workspaceArchive = join(destination, copy.workspaceId);
		if (!existsSync(workspaceArchive))
			mkdirSync(workspaceArchive, { mode: 0o700 });
		privateDirectory(workspaceArchive);
		const archive = join(workspaceArchive, copy.terminalId);
		mkdirSync(archive, { mode: 0o700 });
		try {
			writeFileSync(join(archive, "meta.json"), metadata, {
				mode: 0o600,
				flag: "wx",
			});
			writeFileSync(join(archive, "scrollback.bin"), scrollback, {
				mode: 0o600,
				flag: "wx",
			});
			if (agentCapture)
				writeFileSync(
					join(archive, "agent-session.json"),
					JSON.stringify(agentCapture),
					{ mode: 0o600, flag: "wx" },
				);
			result.archives.push({
				workspaceId: copy.workspaceId,
				terminalId: copy.terminalId,
				cwd: absolutePath(copy.cwd) ? copy.cwd : null,
				...(agentCapture ? { agentCapture } : {}),
			});
			totalBytes += metadata.length + scrollback.length;
		} catch (error) {
			rmSync(archive, { recursive: true, force: true });
			throw error;
		}
	}
	return result;
}

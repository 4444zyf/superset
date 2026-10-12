import {
	closeSync,
	constants,
	fstatSync,
	lstatSync,
	openSync,
	readdirSync,
	readSync,
} from "node:fs";
import { isAbsolute, join } from "node:path";
import { AGENT_IDENTITY_IDS } from "@superset/shared/agent-catalog";

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
export interface ImportedLegacyHistoryEntry {
	kind: "static";
	workspaceId: string;
	terminalId: string;
	cwd: string;
	cols: number;
	rows: number;
	startedAt: string;
	endedAt?: string;
	agentId?: string;
	agentSessionId?: string;
}
export interface ImportedLegacyHistoryPage {
	entries: ImportedLegacyHistoryEntry[];
	total: number;
	nextOffset?: number;
}
export interface ImportedLegacyHistoryChunk {
	kind: "static";
	workspaceId: string;
	terminalId: string;
	text: string;
	byteOffset: number;
	nextByteOffset?: number;
	totalBytes: number;
}
function directory(path: string): void {
	const stat = lstatSync(path);
	if (
		!stat.isDirectory() ||
		stat.isSymbolicLink() ||
		stat.uid !== process.getuid?.() ||
		(stat.mode & 0o077) !== 0
	)
		throw new Error("Static history requires owner-only real directories");
}
function archiveRoot(homeDir: string, namespaceId: string): string {
	if (!isAbsolute(homeDir) || !UUID.test(namespaceId) || !process.getuid?.())
		throw new Error("Invalid local history namespace");
	directory(homeDir);
	const host = join(homeDir, "host"),
		namespace = join(host, namespaceId),
		archive = join(namespace, "legacy-history");
	for (const path of [host, namespace, archive]) directory(path);
	return archive;
}
function openFile(path: string, maximum: number): { fd: number; size: number } {
	const fd = openSync(
		path,
		constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
	);
	try {
		const stat = fstatSync(fd);
		if (
			!stat.isFile() ||
			stat.uid !== process.getuid?.() ||
			(stat.mode & 0o077) !== 0 ||
			stat.size > maximum
		)
			throw new Error("Static history must use bounded private regular files");
		return { fd, size: stat.size };
	} catch (error) {
		closeSync(fd);
		throw error;
	}
}
function jsonFile(path: string): Record<string, unknown> {
	const { fd } = openFile(path, 64 * 1024);
	try {
		const buffer = Buffer.alloc(64 * 1024 + 1);
		let bytes = 0;
		while (bytes < buffer.length) {
			const count = readSync(fd, buffer, bytes, buffer.length - bytes, null);
			if (!count) break;
			bytes += count;
		}
		if (bytes > 64 * 1024)
			throw new Error("Static metadata grew beyond its byte limit");
		const parsed: unknown = JSON.parse(
			buffer.subarray(0, bytes).toString("utf8"),
		);
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
			throw new Error("Invalid static history metadata");
		return parsed as Record<string, unknown>;
	} finally {
		closeSync(fd);
	}
}
function metadata(
	archive: string,
	workspaceId: string,
	terminalId: string,
): ImportedLegacyHistoryEntry {
	const workspace = join(archive, workspaceId),
		terminal = join(workspace, terminalId);
	directory(workspace);
	directory(terminal);
	const meta = jsonFile(join(terminal, "meta.json"));
	if (
		typeof meta.cwd !== "string" ||
		!isAbsolute(meta.cwd) ||
		meta.cwd.length > 4096 ||
		typeof meta.cols !== "number" ||
		!Number.isInteger(meta.cols) ||
		meta.cols < 1 ||
		typeof meta.rows !== "number" ||
		!Number.isInteger(meta.rows) ||
		meta.rows < 1 ||
		typeof meta.startedAt !== "string" ||
		meta.startedAt.length > 128 ||
		!Number.isFinite(Date.parse(meta.startedAt))
	)
		throw new Error("Invalid static terminal metadata");
	const result: ImportedLegacyHistoryEntry = {
		kind: "static",
		workspaceId,
		terminalId,
		cwd: meta.cwd,
		cols: meta.cols,
		rows: meta.rows,
		startedAt: meta.startedAt,
	};
	if (
		typeof meta.endedAt === "string" &&
		meta.endedAt.length <= 128 &&
		Number.isFinite(Date.parse(meta.endedAt))
	)
		result.endedAt = meta.endedAt;
	try {
		const capture = jsonFile(join(terminal, "agent-session.json"));
		if (
			typeof capture.agentId !== "string" ||
			!AGENT_IDENTITY_IDS.some((agent) => agent === capture.agentId) ||
			typeof capture.agentSessionId !== "string" ||
			!capture.agentSessionId ||
			capture.agentSessionId.length > 1024 ||
			/[\0\r\n]/.test(capture.agentSessionId)
		)
			throw new Error("Invalid static provider session metadata");
		result.agentId = capture.agentId;
		result.agentSessionId = capture.agentSessionId;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
	}
	return result;
}
export function listImportedLegacyHistory(options: {
	homeDir: string;
	namespaceId: string;
	offset?: number;
	limit?: number;
}): ImportedLegacyHistoryPage {
	const offset = options.offset ?? 0,
		limit = options.limit ?? 50;
	if (
		!Number.isSafeInteger(offset) ||
		offset < 0 ||
		!Number.isSafeInteger(limit) ||
		limit < 1 ||
		limit > 100
	)
		throw new Error("Invalid static history page");
	let root: string;
	try {
		root = archiveRoot(options.homeDir, options.namespaceId);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT")
			return { entries: [], total: 0 };
		throw error;
	}
	const identities: Array<{ workspaceId: string; terminalId: string }> = [];
	for (const workspaceId of readdirSync(root).sort()) {
		if (!UUID.test(workspaceId))
			throw new Error("Invalid archived workspace identity");
		directory(join(root, workspaceId));
		for (const terminalId of readdirSync(join(root, workspaceId)).sort()) {
			if (!UUID.test(terminalId))
				throw new Error("Invalid archived terminal identity");
			identities.push({ workspaceId, terminalId });
			if (identities.length > 100_000)
				throw new Error("Static history exceeds the supported entry count");
		}
	}
	const entries = identities
		.slice(offset, offset + limit)
		.map(({ workspaceId, terminalId }) =>
			metadata(root, workspaceId, terminalId),
		);
	return {
		entries,
		total: identities.length,
		...(offset + limit < identities.length
			? { nextOffset: offset + limit }
			: {}),
	};
}
export function readImportedLegacyHistory(options: {
	homeDir: string;
	namespaceId: string;
	workspaceId: string;
	terminalId: string;
	byteOffset?: number;
	byteLimit?: number;
}): ImportedLegacyHistoryChunk {
	if (!UUID.test(options.workspaceId) || !UUID.test(options.terminalId))
		throw new Error("Invalid archived resource identity");
	const offset = options.byteOffset ?? 0,
		limit = options.byteLimit ?? 8192;
	if (
		!Number.isSafeInteger(offset) ||
		offset < 0 ||
		!Number.isSafeInteger(limit) ||
		limit < 4 ||
		limit > 8192
	)
		throw new Error("Invalid static scrollback byte range");
	const root = archiveRoot(options.homeDir, options.namespaceId);
	metadata(root, options.workspaceId, options.terminalId);
	const { fd, size } = openFile(
		join(root, options.workspaceId, options.terminalId, "scrollback.bin"),
		5 * 1024 * 1024,
	);
	try {
		if (offset > size)
			throw new Error("Static scrollback offset is past its end");
		const buffer = Buffer.alloc(limit + 4),
			bytes = readSync(fd, buffer, 0, buffer.length, offset);
		if (offset > 0 && bytes > 0 && ((buffer[0] ?? 0) & 0xc0) === 0x80)
			throw new Error("Static scrollback offset must be a UTF-8 boundary");
		let consumed = Math.min(bytes, limit);
		while (
			consumed > 0 &&
			consumed < bytes &&
			((buffer[consumed] ?? 0) & 0xc0) === 0x80
		)
			consumed--;
		if (bytes > 0 && consumed === 0)
			throw new Error("Invalid UTF-8 static scrollback");
		let text: string;
		try {
			text = new TextDecoder("utf-8", { fatal: true }).decode(
				buffer.subarray(0, consumed),
			);
		} catch {
			throw new Error("Invalid UTF-8 static scrollback");
		}
		return {
			kind: "static",
			workspaceId: options.workspaceId,
			terminalId: options.terminalId,
			text,
			byteOffset: offset,
			totalBytes: size,
			...(offset + consumed < size
				? { nextByteOffset: offset + consumed }
				: {}),
		};
	} finally {
		closeSync(fd);
	}
}

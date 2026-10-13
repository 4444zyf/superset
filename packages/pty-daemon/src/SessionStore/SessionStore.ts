import { randomUUID } from "node:crypto";
import type { Pty } from "../Pty/index.ts";
import type { SessionInfo } from "../protocol/index.ts";
import {
	TerminalModes,
	type TerminalModesSnapshot,
} from "../TerminalModes/index.ts";
import { TerminalColors } from "./TerminalColors/index.ts";

const DEFAULT_BUFFER_BYTES = 64 * 1024;

export interface Session {
	id: string;
	executionId: string;
	pty: Pty;
	modes: TerminalModes;
	colors: TerminalColors;
	/** ring buffer for replay-on-attach; in-memory only, never persisted. */
	buffer: Buffer[];
	bufferBytes: number;
	bufferCap: number;
	exited: boolean;
	exitCode: number | null;
	exitSignal: number | null;
}

export interface SessionStoreOptions {
	bufferCap?: number;
	completionLimit?: number;
	completionBufferCap?: number;
	completionRetentionMs?: number;
	now?: () => number;
}

export interface CompletedSession {
	id: string;
	output: Buffer;
	modes: TerminalModesSnapshot;
	code: number | null;
	signal: number | null;
}

/**
 * In-memory map of active sessions. Daemon-local state; nothing is persisted.
 *
 * Replay buffer is a circular FIFO of byte chunks per session, capped by
 * total byte size. When new output exceeds the cap, oldest chunks are
 * dropped (head). The cap is small (~64 KB) — enough to redraw a typical
 * shell screen on attach. Larger scrollback is the renderer's xterm.js
 * responsibility.
 */
export class SessionStore {
	private readonly sessions = new Map<string, Session>();
	private readonly bufferCap: number;
	private readonly completions = new Map<
		string,
		{ result: CompletedSession; expiresAt: number }
	>();
	private completionBytes = 0;
	private readonly completionLimit: number;
	private readonly completionBufferCap: number;
	private readonly completionRetentionMs: number;
	private readonly now: () => number;

	/** Retention this store was configured with, for handoff to a successor. */
	get bufferCapBytes(): number {
		return this.bufferCap;
	}

	constructor(opts: SessionStoreOptions = {}) {
		this.bufferCap = opts.bufferCap ?? DEFAULT_BUFFER_BYTES;
		this.completionLimit = opts.completionLimit ?? 32;
		this.completionBufferCap = opts.completionBufferCap ?? 2 * 1024 * 1024;
		this.completionRetentionMs = opts.completionRetentionMs ?? 30_000;
		this.now = opts.now ?? Date.now;
	}

	add(id: string, pty: Pty, executionId: string = randomUUID()): Session {
		if (this.sessions.has(id)) {
			throw new Error(`session already exists: ${id}`);
		}
		this.deleteCompletion(id);
		const session: Session = {
			id,
			executionId,
			pty,
			modes: new TerminalModes(),
			colors: new TerminalColors(
				pty.meta.colors,
				pty.meta.env?.TERM_THEME === "light" ||
					pty.meta.env?.COLORFGBG === "0;15",
			),
			buffer: [],
			bufferBytes: 0,
			bufferCap: this.bufferCap,
			exited: false,
			exitCode: null,
			exitSignal: null,
		};
		this.sessions.set(id, session);
		return session;
	}

	get(id: string): Session | undefined {
		return this.sessions.get(id);
	}

	delete(id: string): boolean {
		return this.sessions.delete(id);
	}

	complete(session: Session): void {
		if (this.sessions.get(session.id) !== session) return;
		this.sessions.delete(session.id);
		this.pruneCompletions();
		this.deleteCompletion(session.id);
		const buffered = this.snapshotBuffer(session);
		const output = Buffer.from(
			buffered.subarray(
				Math.max(0, buffered.byteLength - this.completionBufferCap),
			),
		);
		this.completions.set(session.id, {
			result: {
				id: session.id,
				output,
				modes: session.modes.snapshot(),
				code: session.exitCode,
				signal: session.exitSignal,
			},
			expiresAt: this.now() + this.completionRetentionMs,
		});
		this.completionBytes += output.byteLength;
		while (
			this.completions.size > this.completionLimit ||
			this.completionBytes > this.completionBufferCap
		) {
			const oldest = this.completions.keys().next().value;
			if (oldest === undefined) break;
			this.deleteCompletion(oldest);
		}
	}

	getCompletion(id: string): CompletedSession | undefined {
		this.pruneCompletions();
		return this.completions.get(id)?.result;
	}

	private pruneCompletions(): void {
		const now = this.now();
		for (const [id, entry] of this.completions) {
			if (entry.expiresAt <= now) this.deleteCompletion(id);
		}
	}

	private deleteCompletion(id: string): void {
		const entry = this.completions.get(id);
		if (!entry) return;
		this.completionBytes -= entry.result.output.byteLength;
		this.completions.delete(id);
	}

	list(): SessionInfo[] {
		const out: SessionInfo[] = [];
		for (const s of this.sessions.values()) {
			out.push({
				id: s.id,
				executionId: s.executionId,
				pid: s.pty.pid,
				cols: s.pty.meta.cols,
				rows: s.pty.meta.rows,
				alive: !s.exited,
			});
		}
		return out;
	}

	all(): IterableIterator<Session> {
		return this.sessions.values();
	}

	size(): number {
		return this.sessions.size;
	}

	/** Append output to a session's ring buffer; evict oldest chunks past the cap. */
	appendOutput(session: Session, chunk: Buffer): void {
		session.modes.feed(chunk);
		session.buffer.push(chunk);
		session.bufferBytes += chunk.byteLength;
		while (
			session.bufferBytes > session.bufferCap &&
			session.buffer.length > 0
		) {
			const head = session.buffer.shift();
			if (head) session.bufferBytes -= head.byteLength;
		}
	}

	/** Snapshot the buffered bytes for replay; doesn't clear the buffer. */
	snapshotBuffer(session: Session): Buffer {
		return Buffer.concat(session.buffer);
	}
}

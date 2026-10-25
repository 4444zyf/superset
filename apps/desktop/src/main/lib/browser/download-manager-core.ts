import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { existsSync } from "node:fs";
import { basename, extname, join } from "node:path";
import { downloads } from "@superset/local-db/downloads";
import { and, desc, eq, ne, notInArray } from "drizzle-orm";
import type { Session } from "electron";
import type { BaseSQLiteDatabase } from "drizzle-orm/sqlite-core";

export const MAX_TRACKED_DOWNLOADS = 200;

/**
 * Tracks downloads started from the in-app browser pane's session. A single
 * `will-download` listener on the shared partition covers every pane (and
 * window) using it, matching a normal browser's one global downloads list.
 */
export interface DownloadManagerDependencies {
	session(): Pick<Session, "setDownloadPath" | "on" | "off">;
	directory(): string;
	showInFolder(path: string): void;
	openFile(path: string): Promise<string>;
}
export class DownloadManagerCore<
	TRunResult,
	TSchema extends Record<string, unknown>,
> extends EventEmitter {
	constructor(
		private readonly db: BaseSQLiteDatabase<"sync", TRunResult, TSchema>,
		private readonly dependencies: DownloadManagerDependencies,
	) {
		super();
	}
	private activeItems = new Map<string, Electron.DownloadItem>();
	// Paths chosen for a download that's still in flight — `existsSync` alone
	// can't see these, since Electron doesn't create the file on disk until
	// the transfer actually starts writing, so two downloads picked close
	// together could otherwise resolve to (and overwrite) the same path.
	private reservedPaths = new Set<string>();
	private started = false;
	private stopListening: (() => void) | undefined;
	private activeCleanups = new Map<string, () => void>();

	/** Chrome-style dedupe: "report.pdf" -> "report (1).pdf" -> "report (2).pdf". */
	private reserveSavePath(dir: string, filename: string): string {
		const ext = extname(filename);
		const base = basename(filename, ext);
		let candidate = join(dir, filename);
		for (
			let n = 1;
			existsSync(candidate) || this.reservedPaths.has(candidate);
			n++
		) {
			candidate = join(dir, `${base} (${n})${ext}`);
		}
		this.reservedPaths.add(candidate);
		return candidate;
	}

	start(): void {
		if (this.started) return;
		this.started = true;

		// A row left "progressing" from a previous run has no live DownloadItem
		// to resume — the app doesn't persist partial-download state across
		// restarts, so it can only ever be reported as interrupted.
		this.db
			.update(downloads)
			.set({ state: "interrupted" })
			.where(eq(downloads.state, "progressing"))
			.run();

		const ses = this.dependencies.session();
		const downloadDir = this.dependencies.directory();
		ses.setDownloadPath(downloadDir);

		const onDownload = (
			_event: Electron.Event,
			item: Electron.DownloadItem,
		) => {
			const id = randomUUID();
			const savePath = this.reserveSavePath(downloadDir, item.getFilename());
			item.setSavePath(savePath);

			this.db
				.insert(downloads)
				.values({
					id,
					url: item.getURL(),
					filename: basename(savePath),
					savePath,
					mimeType: item.getMimeType() || null,
					totalBytes: item.getTotalBytes() || null,
					receivedBytes: 0,
					state: "progressing",
					startedAt: Date.now(),
				})
				.run();
			this.activeItems.set(id, item);
			this.emit("changed");

			const onUpdated = (
				_e: Electron.Event,
				state: "progressing" | "interrupted",
			) => {
				if (this.activeItems.get(id) !== item) return;
				this.db
					.update(downloads)
					.set({
						receivedBytes: item.getReceivedBytes(),
						totalBytes: item.getTotalBytes() || null,
						state: state === "progressing" ? "progressing" : "interrupted",
					})
					.where(eq(downloads.id, id))
					.run();
				this.emit("changed");
			};
			const onDone = (
				_e: Electron.Event,
				state: "completed" | "cancelled" | "interrupted",
			) => {
				if (this.activeItems.get(id) !== item) return;
				this.activeCleanups.get(id)?.();
				this.activeCleanups.delete(id);
				this.activeItems.delete(id);
				this.reservedPaths.delete(savePath);
				this.db
					.update(downloads)
					.set({
						state,
						receivedBytes: item.getReceivedBytes(),
						completedAt: Date.now(),
					})
					.where(eq(downloads.id, id))
					.run();
				this.emit("changed");
			};
			this.activeCleanups.set(id, () => {
				item.off("updated", onUpdated);
				item.off("done", onDone);
			});
			item.on("updated", onUpdated);
			item.once("done", onDone);
		};
		ses.on("will-download", onDownload);
		this.stopListening = () => {
			ses.off("will-download", onDownload);
		};
	}

	/** Detach callbacks before a private profile database closes. */
	stop(): void {
		if (!this.started) return;
		this.started = false;
		this.stopListening?.();
		this.stopListening = undefined;
		for (const [id, item] of this.activeItems) {
			this.activeCleanups.get(id)?.();
			// Electron may already have destroyed the item during app shutdown.
			try {
				item.cancel();
			} catch {}
		}
		this.activeItems.clear();
		this.activeCleanups.clear();
		this.reservedPaths.clear();
		this.db
			.update(downloads)
			.set({ state: "interrupted" })
			.where(eq(downloads.state, "progressing"))
			.run();
	}

	list() {
		return this.db
			.select()
			.from(downloads)
			.orderBy(desc(downloads.startedAt))
			.limit(MAX_TRACKED_DOWNLOADS)
			.all();
	}

	getById(id: string) {
		return this.db.select().from(downloads).where(eq(downloads.id, id)).get();
	}

	/** True if a live in-progress download was found and cancelled. */
	cancel(id: string): boolean {
		const item = this.activeItems.get(id);
		if (!item) return false;
		item.cancel();
		return true;
	}

	/** Clears finished entries; downloads still in flight are left alone. */
	clear(): void {
		const activeIds = [...this.activeItems.keys()];
		this.db
			.delete(downloads)
			.where(
				and(
					ne(downloads.state, "progressing"),
					notInArray(downloads.id, activeIds),
				),
			)
			.run();
		this.emit("changed");
	}

	showInFolder(savePath: string): void {
		this.dependencies.showInFolder(savePath);
	}

	openFile(savePath: string): Promise<string> {
		return this.dependencies.openFile(savePath);
	}
}

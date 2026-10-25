import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { screenshots } from "@superset/local-db/screenshots";
import { desc, eq } from "drizzle-orm";
import type { BaseSQLiteDatabase } from "drizzle-orm/sqlite-core";

const MAX_LISTED_SCREENSHOTS = 200;
const THUMBNAIL_WIDTH = 200;

/** Chrome-style timestamped filename, e.g. "Screenshot 2026-08-26 at 14.05.32.png". */
function timestampedFilename(): string {
	const now = new Date();
	const pad = (n: number) => String(n).padStart(2, "0");
	return `Screenshot ${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} at ${pad(
		now.getHours(),
	)}.${pad(now.getMinutes())}.${pad(now.getSeconds())}.png`;
}

/**
 * Persists page captures taken from the browser pane's overflow menu — the
 * capture itself (and its clipboard copy) stays in BrowserManager; this is
 * just where a capture ends up once someone wants to see it again.
 */
export interface ScreenshotManagerDependencies {
	directory(): string;
	thumbnail?(image: Electron.NativeImage): string;
	showInFolder(path: string): void;
	openFile(path: string): Promise<string>;
}
export class ScreenshotManagerCore<
	TRunResult,
	TSchema extends Record<string, unknown>,
> extends EventEmitter {
	constructor(
		private readonly db: BaseSQLiteDatabase<"sync", TRunResult, TSchema>,
		private readonly dependencies: ScreenshotManagerDependencies,
	) {
		super();
	}
	save(image: Electron.NativeImage, url: string) {
		const base = timestampedFilename();
		const directory = this.dependencies.directory();
		const pngBuffer = image.toPNG();
		let filename = base,
			savePath = join(directory, filename),
			suffix = 0;
		for (;;) {
			try {
				writeFileSync(savePath, pngBuffer, { flag: "wx" });
				break;
			} catch (error) {
				if (
					!(error instanceof Error) ||
					!("code" in error) ||
					error.code !== "EEXIST"
				)
					throw error;
				filename = `${base.slice(0, -4)} (${++suffix}).png`;
				savePath = join(directory, filename);
			}
		}

		const { width, height } = image.getSize();
		// A downscaled copy stored alongside the row means the gallery can
		// render a grid of real previews without reading every file on disk.
		const thumbnail =
			this.dependencies.thumbnail?.(image) ??
			image.resize({ width: THUMBNAIL_WIDTH }).toDataURL();
		const id = randomUUID();

		this.db
			.insert(screenshots)
			.values({
				id,
				url,
				filename,
				savePath,
				width,
				height,
				thumbnail,
				capturedAt: Date.now(),
			})
			.run();
		this.emit("changed");

		return { id, savePath, base64: pngBuffer.toString("base64") };
	}

	list() {
		return this.db
			.select()
			.from(screenshots)
			.orderBy(desc(screenshots.capturedAt))
			.limit(MAX_LISTED_SCREENSHOTS)
			.all();
	}

	getById(id: string) {
		return this.db
			.select()
			.from(screenshots)
			.where(eq(screenshots.id, id))
			.get();
	}

	/** Clears tracked rows; the PNGs stay on disk, same as clearing a downloads list. */
	clear(): void {
		this.db.delete(screenshots).run();
		this.emit("changed");
	}

	showInFolder(savePath: string): void {
		this.dependencies.showInFolder(savePath);
	}

	openFile(savePath: string): Promise<string> {
		return this.dependencies.openFile(savePath);
	}
}

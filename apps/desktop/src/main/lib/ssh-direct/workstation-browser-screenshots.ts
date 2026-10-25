import { chmodSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { screenshots } from "@superset/local-db/screenshots";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { desc, eq } from "drizzle-orm";
import {
	ScreenshotManagerCore,
	type ScreenshotManagerDependencies,
} from "../browser/screenshot-manager-core";
import { initializeBrowserDatabase } from "../browser/initialize-browser-database";

export function screenshotThumbnail(image: Electron.NativeImage): string {
	const { width, height } = image.getSize(),
		scale = Math.min(1, 200 / width, 200 / height);
	return image
		.resize({
			width: Math.max(1, Math.round(width * scale)),
			height: Math.max(1, Math.round(height * scale)),
		})
		.toDataURL();
}
function createManager(
	sqlite: InstanceType<typeof Database>,
	dependencies: ScreenshotManagerDependencies,
) {
	return new ScreenshotManagerCore(
		drizzle(sqlite, { schema: { screenshots } }),
		dependencies,
	);
}
export class WorkstationBrowserScreenshots {
	private readonly sqlite: InstanceType<typeof Database>;
	readonly manager: ReturnType<typeof createManager>;
	readonly listForDisplay: () => import("../../../shared/workstation-browser").WorkstationScreenshotRow[];
	readonly fileForId: (id: string) => { savePath: string } | undefined;
	constructor(
		filename: string,
		migrationSql: string,
		dependencies: ScreenshotManagerDependencies,
	) {
		mkdirSync(dirname(filename), { recursive: true, mode: 0o700 });
		this.sqlite = new Database(filename);
		try {
			chmodSync(filename, 0o600);
			this.sqlite.pragma("journal_mode = WAL");
			initializeBrowserDatabase(this.sqlite, migrationSql, "screenshots");
			const db = drizzle(this.sqlite, { schema: { screenshots } });
			this.listForDisplay = () =>
				db
					.select({
						id: screenshots.id,
						filename: screenshots.filename,
						savePath: screenshots.savePath,
						width: screenshots.width,
						height: screenshots.height,
						thumbnail: screenshots.thumbnail,
						capturedAt: screenshots.capturedAt,
					})
					.from(screenshots)
					.orderBy(desc(screenshots.capturedAt))
					.limit(200)
					.all();
			this.fileForId = (id) =>
				db
					.select({ savePath: screenshots.savePath })
					.from(screenshots)
					.where(eq(screenshots.id, id))
					.get();
			this.manager = createManager(this.sqlite, {
				...dependencies,
				thumbnail: screenshotThumbnail,
			});
		} catch (error) {
			this.sqlite.close();
			throw error;
		}
	}
	close(): void {
		this.sqlite.close();
	}
}

import { chmodSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { downloads } from "@superset/local-db/downloads";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { desc, eq } from "drizzle-orm";
import type { WorkstationDownloadRow } from "../../../shared/workstation-browser";
import {
	DownloadManagerCore,
	MAX_TRACKED_DOWNLOADS,
	type DownloadManagerDependencies,
} from "../browser/download-manager-core";
import { initializeBrowserDatabase } from "../browser/initialize-browser-database";

function createManager(
	sqlite: InstanceType<typeof Database>,
	dependencies: DownloadManagerDependencies,
) {
	return new DownloadManagerCore(
		drizzle(sqlite, { schema: { downloads } }),
		dependencies,
	);
}
export class WorkstationBrowserDownloads {
	private readonly sqlite: InstanceType<typeof Database>;
	readonly manager: ReturnType<typeof createManager>;
	readonly listForDisplay: () => WorkstationDownloadRow[];
	readonly fileForId: (id: string) => { savePath: string } | undefined;
	constructor(
		filename: string,
		migrationSql: string,
		dependencies: DownloadManagerDependencies,
	) {
		mkdirSync(dirname(filename), { recursive: true, mode: 0o700 });
		this.sqlite = new Database(filename);
		try {
			chmodSync(filename, 0o600);
			this.sqlite.pragma("journal_mode = WAL");
			initializeBrowserDatabase(this.sqlite, migrationSql, "downloads");
			const db = drizzle(this.sqlite, { schema: { downloads } });
			this.listForDisplay = () =>
				db
					.select({
						id: downloads.id,
						filename: downloads.filename,
						receivedBytes: downloads.receivedBytes,
						totalBytes: downloads.totalBytes,
						state: downloads.state,
					})
					.from(downloads)
					.orderBy(desc(downloads.startedAt))
					.limit(MAX_TRACKED_DOWNLOADS)
					.all();
			this.fileForId = (id) =>
				db
					.select({ savePath: downloads.savePath })
					.from(downloads)
					.where(eq(downloads.id, id))
					.get();
			this.manager = createManager(this.sqlite, dependencies);
			this.manager.start();
		} catch (error) {
			this.sqlite.close();
			throw error;
		}
	}
	close(): void {
		try {
			this.manager.stop();
		} finally {
			this.sqlite.close();
		}
	}
}

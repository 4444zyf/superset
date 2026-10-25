import { chmodSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { browserHistory } from "@superset/local-db/browser-history";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import {
	type BrowserHistoryVisit,
	createBrowserHistoryRepository,
} from "../browser/browser-history-repository";
import { initializeBrowserHistory } from "../browser/initialize-browser-history";

export class WorkstationBrowserHistory {
	private readonly sqlite: InstanceType<typeof Database>;
	private readonly repository: ReturnType<
		typeof createBrowserHistoryRepository
	>;

	constructor(filename: string, migrationSql: string) {
		mkdirSync(dirname(filename), { recursive: true, mode: 0o700 });
		this.sqlite = new Database(filename);
		try {
			chmodSync(filename, 0o600);
			this.sqlite.pragma("journal_mode = WAL");
			initializeBrowserHistory(this.sqlite, migrationSql);
			this.repository = createBrowserHistoryRepository(
				drizzle(this.sqlite, { schema: { browserHistory } }),
			);
		} catch (error) {
			this.sqlite.close();
			throw error;
		}
	}

	getAll() {
		return this.repository.getAll();
	}
	search(input: { query: string; limit?: number }) {
		return this.repository.search(input);
	}
	upsert(input: BrowserHistoryVisit): void {
		this.repository.upsert(input);
	}
	clear(): void {
		this.repository.clear();
	}
	close(): void {
		this.sqlite.close();
	}
}

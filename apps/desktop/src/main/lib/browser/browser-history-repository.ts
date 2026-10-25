import type { ImportedHistoryEntry } from "./chrome-history-import";
import { browserHistory } from "@superset/local-db/browser-history";
import { like, or, sql } from "drizzle-orm";
import type { BaseSQLiteDatabase } from "drizzle-orm/sqlite-core";

const IMPORT_CHUNK_SIZE = 200;

export interface BrowserHistoryVisit {
	url: string;
	title: string;
	faviconUrl?: string | null;
}

export function createBrowserHistoryRepository<
	TRunResult,
	TSchema extends Record<string, unknown>,
>(db: BaseSQLiteDatabase<"sync", TRunResult, TSchema>) {
	return {
		getAll() {
			return db
				.select()
				.from(browserHistory)
				.orderBy(sql`${browserHistory.lastVisitedAt} desc`)
				.limit(500)
				.all();
		},
		search(input: { query: string; limit?: number }) {
			const pattern = `%${input.query}%`;
			return db
				.select()
				.from(browserHistory)
				.where(
					or(
						like(browserHistory.url, pattern),
						like(browserHistory.title, pattern),
					),
				)
				.orderBy(sql`${browserHistory.lastVisitedAt} desc`)
				.limit(input.limit ?? 10)
				.all();
		},
		upsert(input: BrowserHistoryVisit) {
			db.insert(browserHistory)
				.values({
					url: input.url,
					title: input.title,
					faviconUrl: input.faviconUrl ?? null,
					lastVisitedAt: Date.now(),
					visitCount: 1,
				})
				.onConflictDoUpdate({
					target: browserHistory.url,
					set: {
						title: input.title,
						faviconUrl: input.faviconUrl ?? null,
						lastVisitedAt: Date.now(),
						visitCount: sql`${browserHistory.visitCount} + 1`,
					},
				})
				.run();
		},
		importEntries(entries: ImportedHistoryEntry[]) {
			db.transaction((tx) => {
				for (let i = 0; i < entries.length; i += IMPORT_CHUNK_SIZE) {
					const chunk = entries.slice(i, i + IMPORT_CHUNK_SIZE);
					tx.insert(browserHistory)
						.values(
							chunk.map((entry) => ({
								url: entry.url,
								title: entry.title,
								faviconUrl: null,
								lastVisitedAt: entry.lastVisitedAt,
								visitCount: entry.visitCount,
							})),
						)
						.onConflictDoUpdate({
							target: browserHistory.url,
							set: {
								// Keep an existing title if the import has none.
								title: sql`coalesce(nullif(excluded.title, ''), ${browserHistory.title})`,
								lastVisitedAt: sql`max(${browserHistory.lastVisitedAt}, excluded.last_visited_at)`,
								// max, not sum, so re-importing doesn't inflate counts.
								visitCount: sql`max(${browserHistory.visitCount}, excluded.visit_count)`,
							},
						})
						.run();
				}
			});
		},
		clear() {
			db.delete(browserHistory).run();
		},
	};
}

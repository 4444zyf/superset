import { browserHistory } from "@superset/local-db/browser-history";
import { like, or, sql } from "drizzle-orm";
import type { BaseSQLiteDatabase } from "drizzle-orm/sqlite-core";

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
		clear() {
			db.delete(browserHistory).run();
		},
	};
}

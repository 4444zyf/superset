import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { browserHistory } from "@superset/local-db/browser-history";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { createBrowserHistoryRepository } from "./browser-history-repository";
import { initializeBrowserHistory } from "./initialize-browser-history";

const migration = readFileSync(
	resolve(
		import.meta.dir,
		"../../../../../../packages/local-db/drizzle/0026_browser_history.sql",
	),
	"utf8",
);

function fixture() {
	const sqlite = new Database(":memory:");
	initializeBrowserHistory(sqlite, migration);
	const db = drizzle(sqlite, { schema: { browserHistory } });
	return { sqlite, db, history: createBrowserHistoryRepository(db) };
}

test("visits retain identity, update title/favicon and increment the original URL counter", () => {
	const { sqlite, history } = fixture();
	try {
		history.upsert({
			url: "https://example.com/中文?q='x'",
			title: "First",
			faviconUrl: "https://example.com/icon.png",
		});
		const [first] = history.getAll();
		history.upsert({
			url: "https://example.com/中文?q='x'",
			title: "第二次 🙂",
		});
		const [second] = history.getAll();
		expect(second?.id).toBe(first?.id);
		expect(second?.id).toMatch(/^[0-9a-f-]{36}$/);
		expect(second?.visitCount).toBe(2);
		expect(second?.title).toBe("第二次 🙂");
		expect(second?.faviconUrl).toBeNull();
		expect(second?.lastVisitedAt).toBeGreaterThanOrEqual(
			first?.lastVisitedAt ?? Infinity,
		);
		expect(history.getAll()).toHaveLength(1);
	} finally {
		sqlite.close();
	}
});

test("search matches the original URL/title LIKE semantics and keeps query text bound", () => {
	const { sqlite, history } = fixture();
	try {
		history.upsert({ url: "https://example.com/alpha", title: "中文 页面" });
		history.upsert({
			url: "https://example.org/elsewhere",
			title: "Alpha title",
		});
		expect(history.search({ query: "alpha" })).toHaveLength(2);
		expect(history.search({ query: "中文" })).toHaveLength(1);
		expect(history.search({ query: "' OR 1=1 --" })).toEqual([]);
		expect(history.search({ query: "%", limit: 1 })).toHaveLength(1);
	} finally {
		sqlite.close();
	}
});

test("the original recent list and search limits preserve descending visit order", () => {
	const { sqlite, db, history } = fixture();
	try {
		db.insert(browserHistory)
			.values(
				Array.from({ length: 501 }, (_, index) => ({
					url: `https://example.com/page/${index}`,
					title: "Page",
					lastVisitedAt: index,
				})),
			)
			.run();
		const rows = history.getAll();
		expect(rows).toHaveLength(500);
		expect(rows[0]?.lastVisitedAt).toBe(500);
		expect(rows.at(-1)?.lastVisitedAt).toBe(1);
		expect(history.search({ query: "page" })).toHaveLength(10);
		expect(history.search({ query: "page", limit: 200 })).toHaveLength(200);
		expect(
			history.search({ query: "page/0", limit: 100 }).map((row) => row.url),
		).toEqual(["https://example.com/page/0"]);
	} finally {
		sqlite.close();
	}
});

test("reopening the schema preserves real rows, and clear removes them", () => {
	const { sqlite, history } = fixture();
	try {
		history.upsert({ url: "https://example.com/", title: "Persisted" });
		initializeBrowserHistory(sqlite, migration);
		expect(history.getAll()[0]?.title).toBe("Persisted");
		history.clear();
		expect(history.getAll()).toEqual([]);
		expect(
			sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table'").all(),
		).toEqual([{ name: "browser_history" }]);
	} finally {
		sqlite.close();
	}
});

test("initialization rejects foreign data and rolls back failed creation", () => {
	const foreign = new Database(":memory:");
	const failed = new Database(":memory:");
	try {
		foreign.exec(
			"CREATE TABLE unrelated (value TEXT); INSERT INTO unrelated VALUES ('keep')",
		);
		expect(() => initializeBrowserHistory(foreign, migration)).toThrow(
			"Unrecognized",
		);
		expect(foreign.prepare("SELECT value FROM unrelated").get()).toEqual({
			value: "keep",
		});
		expect(() =>
			initializeBrowserHistory(failed, `${migration}\ninvalid SQL;`),
		).toThrow();
		expect(failed.prepare("PRAGMA user_version").get()).toEqual({
			user_version: 0,
		});
		expect(
			failed.prepare("SELECT name FROM sqlite_master WHERE type='table'").all(),
		).toEqual([]);
	} finally {
		foreign.close();
		failed.close();
	}
});

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
	return {
		sqlite,
		history: createBrowserHistoryRepository(
			drizzle(sqlite, { schema: { browserHistory } }),
		),
	};
}

test("import merges across original chunks without losing existing identity, title, favicon or inflating repeated counts", () => {
	const { sqlite, history } = fixture();
	try {
		history.upsert({
			url: "https://owned.test/current",
			title: "Current 中文",
			faviconUrl: "https://owned.test/icon.png",
		});
		const existing = history.getAll()[0];
		if (!existing) throw Error("Missing visit");
		const entries = Array.from({ length: 201 }, (_, index) => ({
			url: `https://owned.test/import/${index}`,
			title: `Imported ${index}`,
			lastVisitedAt: 1000 + index,
			visitCount: 7,
		}));
		const merge = {
			url: existing.url,
			title: "",
			lastVisitedAt: existing.lastVisitedAt - 1,
			visitCount: 9,
		};
		history.importEntries([merge, ...entries]);
		history.importEntries([merge, ...entries]);
		const rows = history.getAll(),
			current = rows.find((row) => row.url === existing.url);
		expect(rows.length).toBe(202);
		expect(current).toEqual({ ...existing, visitCount: 9 });
		expect(rows.find((row) => row.url === entries[200]?.url)?.visitCount).toBe(
			7,
		);
	} finally {
		sqlite.close();
	}
});
test("a failure in the second import chunk rolls back its earlier rows and updates", () => {
	const { sqlite, history } = fixture();
	try {
		history.upsert({ url: "https://owned.test/current", title: "Keep" });
		const before = history.getAll();
		sqlite.exec(
			"CREATE TRIGGER reject_owned_row BEFORE INSERT ON browser_history WHEN new.url='https://owned.test/rejected' BEGIN SELECT RAISE(FAIL, 'owned source failure'); END",
		);
		const entries = Array.from({ length: 201 }, (_, index) => ({
			url:
				index === 200
					? "https://owned.test/rejected"
					: index === 0
						? "https://owned.test/current"
						: `https://owned.test/${index}`,
			title: "Import",
			lastVisitedAt: 1000,
			visitCount: 4,
		}));
		expect(() => history.importEntries(entries)).toThrow(
			"owned source failure",
		);
		expect(history.getAll()).toEqual(before);
	} finally {
		sqlite.close();
	}
});

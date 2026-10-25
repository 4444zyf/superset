import { Database } from "bun:sqlite";
import { expect, test, setSystemTime } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { screenshots } from "@superset/local-db/screenshots";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { ScreenshotManagerCore } from "./screenshot-manager-core";
const migration = readFileSync(
	resolve(
		import.meta.dir,
		"../../../../../../packages/local-db/drizzle/0052_add_screenshots.sql",
	),
	"utf8",
);
const image = (text: string) =>
	({
		toPNG: () => Buffer.from(text),
		getSize: () => ({ width: 40, height: 20 }),
		resize: () => ({ toDataURL: () => "data:image/png;base64,QQ==" }),
	}) as unknown as Electron.NativeImage;
test("two screenshots in the same second retain distinct files and metadata clear keeps their pixels", () => {
	const dir = mkdtempSync(join(tmpdir(), "owned-browser-screenshots-")),
		sqlite = new Database(":memory:");
	sqlite.exec(migration);
	const manager = new ScreenshotManagerCore(
		drizzle(sqlite, { schema: { screenshots } }),
		{ directory: () => dir, showInFolder: () => {}, openFile: async () => "" },
	);
	try {
		setSystemTime(new Date("2026-10-25T12:00:00Z"));
		const first = manager.save(
				image("first pixels"),
				"https://example.test/one",
			),
			second = manager.save(image("second pixels"), "https://example.test/two");
		expect(first.savePath === second.savePath).toBe(false);
		expect(readFileSync(first.savePath, "utf8")).toBe("first pixels");
		expect(readFileSync(second.savePath, "utf8")).toBe("second pixels");
		expect(manager.list()).toHaveLength(2);
		manager.clear();
		expect(manager.list()).toEqual([]);
		expect(readFileSync(first.savePath, "utf8")).toBe("first pixels");
		expect(readFileSync(second.savePath, "utf8")).toBe("second pixels");
	} finally {
		setSystemTime();
		sqlite.close();
		rmSync(dir, { recursive: true, force: true });
	}
});

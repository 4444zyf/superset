import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { downloads } from "@superset/local-db/downloads";
import { drizzle } from "drizzle-orm/bun-sqlite";
import type { Session } from "electron";
import { DownloadManagerCore } from "./download-manager-core";
const migration = readFileSync(
	resolve(
		import.meta.dir,
		"../../../../../../packages/local-db/drizzle/0051_add_downloads.sql",
	),
	"utf8",
);
class Item extends EventEmitter {
	path = "";
	received = 0;
	cancelled = false;
	constructor(readonly url: string) {
		super();
	}
	getFilename() {
		return "report.txt";
	}
	getURL() {
		return this.url;
	}
	getMimeType() {
		return "text/plain";
	}
	getTotalBytes() {
		return 4;
	}
	getReceivedBytes() {
		return this.received;
	}
	setSavePath(path: string) {
		this.path = path;
	}
	cancel() {
		this.cancelled = true;
		this.emit("done", {}, "cancelled");
	}
}
function fixture() {
	const directory = mkdtempSync(join(tmpdir(), "owned-browser-downloads-")),
		sqlite = new Database(":memory:");
	sqlite.exec(migration);
	const db = drizzle(sqlite, { schema: { downloads } }),
		session = Object.assign(new EventEmitter(), {
			setDownloadPath: (_path: string) => {},
		});
	const manager = new DownloadManagerCore(db, {
		session: () =>
			session as unknown as Pick<Session, "on" | "off" | "setDownloadPath">,
		directory: () => directory,
		showInFolder: () => {},
		openFile: async () => "",
	});
	return {
		directory,
		sqlite,
		db,
		session,
		manager,
		cleanup() {
			manager.stop();
			session.removeAllListeners();
			try {
				sqlite.close();
			} catch {}
			rmSync(directory, { recursive: true, force: true });
		},
	};
}
test("concurrent same-name downloads preserve existing files, reserve separate paths and keep active rows when clearing the list", () => {
	const f = fixture();
	try {
		const existing = join(f.directory, "report.txt");
		writeFileSync(existing, "existing");
		f.manager.start();
		const first = new Item("https://example.test/a"),
			second = new Item("https://example.test/b");
		f.session.emit("will-download", {}, first);
		f.session.emit("will-download", {}, second);
		expect(first.path).toBe(join(f.directory, "report (1).txt"));
		expect(second.path).toBe(join(f.directory, "report (2).txt"));
		expect(readFileSync(existing, "utf8")).toBe("existing");
		writeFileSync(first.path, "four");
		first.received = 4;
		first.emit("done", {}, "completed");
		f.manager.clear();
		const [row] = f.manager.list();
		expect(row?.url).toBe(second.url);
		expect(row?.state).toBe("progressing");
		expect(readFileSync(first.path, "utf8")).toBe("four");
		if (!row) throw Error("Active row missing");
		expect(f.manager.cancel(row.id)).toBe(true);
		expect(f.manager.getById(row.id)?.state).toBe("cancelled");
	} finally {
		f.cleanup();
	}
});
test("shutdown detaches active download callbacks before the private database closes", () => {
	const f = fixture();
	try {
		f.manager.start();
		const item = new Item("https://example.test/active");
		f.session.emit("will-download", {}, item);
		f.manager.stop();
		expect(item.cancelled).toBe(true);
		expect(f.manager.list()[0]?.state).toBe("interrupted");
		f.sqlite.close();
		expect(() => item.emit("updated", {}, "progressing")).not.toThrow();
		expect(() => item.emit("done", {}, "completed")).not.toThrow();
		expect(f.session.listenerCount("will-download")).toBe(0);
	} finally {
		f.cleanup();
	}
});
test("a previous-run progressing row reopens as interrupted without a live item", () => {
	const f = fixture();
	try {
		f.db
			.insert(downloads)
			.values({
				id: "orphan",
				url: "https://example.test/orphan",
				filename: "orphan.txt",
				savePath: join(f.directory, "orphan.txt"),
				state: "progressing",
			})
			.run();
		f.manager.start();
		expect(f.manager.getById("orphan")?.state).toBe("interrupted");
		expect(f.manager.cancel("orphan")).toBe(false);
	} finally {
		f.cleanup();
	}
});

test("clearing finished records preserves an interrupted item that still has an active Electron transfer", () => {
	const f = fixture();
	try {
		f.manager.start();
		const item = new Item("https://example.test/recoverable");
		f.session.emit("will-download", {}, item);
		const [before] = f.manager.list();
		item.emit("updated", {}, "interrupted");
		f.manager.clear();
		expect(f.manager.list().map((row) => row.id)).toEqual([before?.id]);
		item.emit("updated", {}, "progressing");
		expect(f.manager.list()[0]?.state).toBe("progressing");
	} finally {
		f.cleanup();
	}
});

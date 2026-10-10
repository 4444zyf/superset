import { strict as assert } from "node:assert";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { backup, DatabaseSync, type SQLInputValue } from "node:sqlite";
import { test } from "node:test";
import {
	type ActivationJournal,
	backupDatabases,
	restoreDatabases,
	type SqliteDatabase,
} from "./control-runtime";

class SqliteAdapter implements SqliteDatabase {
	private readonly database: DatabaseSync;
	constructor(
		path: string,
		options: { readonly?: boolean; fileMustExist?: boolean } = {},
	) {
		if (options.fileMustExist && !existsSync(path))
			throw new Error("Missing SQLite snapshot");
		this.database = new DatabaseSync(path, { readOnly: options.readonly });
	}
	backup(path: string) {
		return backup(this.database, path);
	}
	close() {
		this.database.close();
	}
	prepare(sql: string) {
		const statement = this.database.prepare(sql);
		return {
			run: (...params: unknown[]) =>
				statement.run(...(params as SQLInputValue[])),
		};
	}
}
function fixture() {
	const home = mkdtempSync(join(tmpdir(), "direct-sqlite-"));
	const config = {
		backendId: "11111111-1111-1111-1111-111111111111",
		namespaceId: "22222222-2222-2222-2222-222222222222",
		homeDir: home,
		secretFile: join(home, "credentials/host-secret"),
		migrationsFolder: "/runtime/old/share/migrations",
		hostServicePath: "/runtime/old/lib/host-service-direct.js",
		allowedOrigins: [],
	};
	const journal: ActivationJournal = {
		formatVersion: 1,
		transactionId: "33333333-3333-3333-3333-333333333333",
		phase: "quiescing",
		oldConfig: config,
		candidateConfig: config,
		oldInstanceId: "old",
		oldVersion: "1.0.0",
		candidateVersion: "1.0.1",
		candidateReleaseId: "new",
		backups: [],
		error: null,
	};
	const databaseRoot = join(home, "host", config.namespaceId);
	mkdirSync(databaseRoot, { recursive: true, mode: 0o700 });
	return { home, journal, databaseRoot };
}
function seed(path: string, value: string) {
	const db = new DatabaseSync(path);
	db.exec(
		"PRAGMA journal_mode=WAL; CREATE TABLE example(value TEXT NOT NULL);",
	);
	db.prepare("INSERT INTO example VALUES (?)").run(value);
	return db;
}
function readValue(path: string) {
	const db = new DatabaseSync(path, { readOnly: true });
	try {
		return db.prepare("SELECT value FROM example").get()?.value;
	} finally {
		db.close();
	}
}
test("SQLite snapshots include committed WAL writes and restore every database before an absent old database can reappear", async () => {
	const f = fixture();
	const host = join(f.databaseRoot, "host.db");
	const operations = join(f.databaseRoot, "operations.db");
	const chat = join(f.databaseRoot, "chat.db");
	const writers = [seed(host, "old host"), seed(operations, "old operations")];
	try {
		assert.ok(statSync(`${host}-wal`).size > 0);
		f.journal.backups = await backupDatabases(f.journal, SqliteAdapter);
		for (const db of writers.splice(0)) db.close();
		assert.equal(
			f.journal.backups.find((item) => item.database === "chat.db")?.absent,
			true,
		);
		const snapshotRoot = join(f.home, "state/backups", f.journal.transactionId);
		assert.equal(readValue(join(snapshotRoot, "host.db")), "old host");
		assert.equal(
			JSON.parse(readFileSync(join(snapshotRoot, "snapshot.json"), "utf8"))
				.phase,
			"complete",
		);
		for (const path of [host, operations]) {
			const db = new DatabaseSync(path);
			db.prepare("UPDATE example SET value = ?").run("candidate write");
			db.close();
		}
		seed(chat, "candidate-only database").close();
		for (const path of [host, operations, chat]) {
			writeFileSync(`${path}-wal`, "leftover candidate WAL");
			writeFileSync(`${path}-shm`, "leftover candidate SHM");
		}
		await restoreDatabases(f.journal, SqliteAdapter);
		for (const path of [host, operations, chat]) {
			assert.equal(existsSync(`${path}-wal`), false);
			assert.equal(existsSync(`${path}-shm`), false);
		}
		assert.equal(readValue(host), "old host");
		assert.equal(readValue(operations), "old operations");
		assert.equal(statSync(host).mode & 0o777, 0o600);
		assert.equal(existsSync(chat), false);
	} finally {
		for (const db of writers) db.close();
		rmSync(f.home, { recursive: true, force: true });
	}
});
test("a missing SQLite snapshot prevents a restore from reporting success", async () => {
	const f = fixture();
	seed(join(f.databaseRoot, "host.db"), "old").close();
	try {
		f.journal.backups = await backupDatabases(f.journal, SqliteAdapter);
		const hostBackup = f.journal.backups.find(
			(item) => item.database === "host.db",
		);
		assert.ok(hostBackup);
		rmSync(hostBackup.backupPath);
		await assert.rejects(
			restoreDatabases(f.journal, SqliteAdapter),
			/Missing SQLite snapshot/,
		);
	} finally {
		rmSync(f.home, { recursive: true, force: true });
	}
});

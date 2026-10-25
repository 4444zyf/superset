import type { SqliteDatabase } from "@superset/direct-connection";

export function initializeBrowserDatabase(
	db: SqliteDatabase,
	migrationSql: string,
	kind: "history" | "downloads" | "screenshots",
): void {
	db.exec("BEGIN IMMEDIATE");
	try {
		const { user_version: version } = db
			.prepare("PRAGMA user_version")
			.get() as { user_version: number };
		if (version === 0) {
			const tables = db
				.prepare(
					"SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
				)
				.all() as { name: string }[];
			if (tables.length)
				throw new Error(`Unrecognized browser ${kind} database`);
			db.exec(migrationSql);
			db.exec("PRAGMA user_version=1");
		} else if (version !== 1) {
			throw new Error(`Unsupported browser ${kind} database version`);
		}
		db.exec("COMMIT");
	} catch (error) {
		db.exec("ROLLBACK");
		throw error;
	}
}

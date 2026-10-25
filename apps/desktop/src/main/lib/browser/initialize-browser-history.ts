import type { SqliteDatabase } from "@superset/direct-connection";
import { initializeBrowserDatabase } from "./initialize-browser-database";
export function initializeBrowserHistory(
	db: SqliteDatabase,
	migrationSql: string,
): void {
	initializeBrowserDatabase(db, migrationSql, "history");
}

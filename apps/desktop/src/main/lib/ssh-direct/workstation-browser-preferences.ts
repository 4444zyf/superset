import { chmodSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { SqliteDatabase } from "@superset/direct-connection";
import BetterSqlite from "better-sqlite3";
import { z } from "zod";
import {
	browserPreferencePatchSchema,
	browserPreferenceValuesSchema,
	defaultBrowserPreferenceValues,
	type BrowserPreferencePatch,
	type BrowserPreferenceSnapshot,
	type BrowserPreferenceValues,
} from "../../../shared/workstation-browser-preferences";

const MAX_BYTES = 64 * 1024;
const revisionSchema = z
	.number()
	.int()
	.nonnegative()
	.max(Number.MAX_SAFE_INTEGER - 1);

export class WorkstationBrowserPreferences {
	private readonly db: SqliteDatabase;
	constructor(database: string | SqliteDatabase) {
		if (typeof database === "string") {
			mkdirSync(dirname(database), { recursive: true, mode: 0o700 });
			this.db = new BetterSqlite(database);
			chmodSync(database, 0o600);
		} else this.db = database;
		this.db.exec(
			"PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS workstation_browser_preferences (id INTEGER PRIMARY KEY CHECK(id=1), schemaVersion INTEGER NOT NULL, revision INTEGER NOT NULL, data TEXT NOT NULL)",
		);
	}
	read(): BrowserPreferenceSnapshot {
		const row = this.db
			.prepare(
				"SELECT schemaVersion, revision, data FROM workstation_browser_preferences WHERE id=1",
			)
			.get() as
			| { schemaVersion: number; revision: number; data: string }
			| undefined;
		if (!row)
			return {
				schemaVersion: 1,
				revision: 0,
				invalid: false,
				values: defaultBrowserPreferenceValues(),
			};
		const revision =
			Number.isSafeInteger(row.revision) && row.revision >= 0
				? row.revision
				: 0;
		try {
			if (
				row.schemaVersion !== 1 ||
				revision !== row.revision ||
				typeof row.data !== "string" ||
				Buffer.byteLength(row.data, "utf8") > MAX_BYTES
			)
				throw Error("Invalid browser preferences");
			return {
				schemaVersion: 1,
				revision,
				invalid: false,
				values: browserPreferenceValuesSchema.parse(JSON.parse(row.data)),
			};
		} catch {
			return {
				schemaVersion: 1,
				revision,
				invalid: true,
				values: defaultBrowserPreferenceValues(),
			};
		}
	}
	update(input: {
		expectedRevision: number;
		patch: BrowserPreferencePatch;
	}): BrowserPreferenceSnapshot {
		const expectedRevision = revisionSchema.parse(input.expectedRevision);
		const patch = browserPreferencePatchSchema.parse(input.patch);
		return this.write(expectedRevision, (current) => {
			if (current.invalid)
				throw Error(
					"Browser preferences are invalid; restore defaults explicitly before editing",
				);
			return browserPreferenceValuesSchema.parse({
				...current.values,
				...patch,
			});
		});
	}
	reset(input: { expectedRevision: number }): BrowserPreferenceSnapshot {
		return this.write(revisionSchema.parse(input.expectedRevision), () =>
			defaultBrowserPreferenceValues(),
		);
	}
	private write(
		expectedRevision: number,
		change: (current: BrowserPreferenceSnapshot) => BrowserPreferenceValues,
	): BrowserPreferenceSnapshot {
		this.db.exec("BEGIN IMMEDIATE");
		try {
			const current = this.read();
			if (current.revision !== expectedRevision)
				throw Error("Browser preference revision changed");
			const values = change(current),
				data = JSON.stringify(values);
			if (Buffer.byteLength(data, "utf8") > MAX_BYTES)
				throw Error("Browser preferences exceed their size limit");
			const revision = current.revision + 1;
			this.db
				.prepare(
					"INSERT INTO workstation_browser_preferences (id,schemaVersion,revision,data) VALUES(1,1,?,?) ON CONFLICT(id) DO UPDATE SET schemaVersion=1, revision=excluded.revision, data=excluded.data",
				)
				.run(revision, data);
			this.db.exec("COMMIT");
			return { schemaVersion: 1, revision, invalid: false, values };
		} catch (error) {
			this.db.exec("ROLLBACK");
			throw error;
		}
	}
	close(): void {
		this.db.close();
	}
}

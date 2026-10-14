import { chmodSync } from "node:fs";
import type { SqliteDatabase } from "@superset/direct-connection";
import { isSupportedLocale, SUPPORTED_LOCALES } from "@superset/i18n/locales";
import {
	FILE_AUTO_SAVE_MODES,
	FILE_OPEN_MODES,
} from "@superset/shared/file-settings";
import { DEFAULT_THEME_ID } from "@superset/shared/themes";
import BetterSqlite from "better-sqlite3";
import {
	setFontSettingsSchema,
	transformFontSettings,
} from "lib/trpc/routers/settings/font-settings.utils";
import {
	DEFAULT_CONFIRM_ON_QUIT,
	DEFAULT_FILE_AUTO_SAVE,
	DEFAULT_FILE_OPEN_MODE,
	DEFAULT_TERMINAL_COPY_ON_SELECT,
} from "shared/constants";
import { z } from "zod";

const MAX_PREFERENCES_BYTES = 64 * 1024;
const fields = {
	agentNativeInputEnabled: z.boolean(),
	language: z.enum(SUPPORTED_LOCALES).nullable(),
	themeId: z.string().min(1).max(128),
	fontSettings: setFontSettingsSchema.strict(),
	fileOpenMode: z.enum(FILE_OPEN_MODES),
	fileAutoSave: z.enum(FILE_AUTO_SAVE_MODES),
	confirmOnQuit: z.boolean(),
	terminalCopyOnSelect: z.boolean(),
};
const valuesSchema = z.strictObject(fields);
const patchSchema = valuesSchema.partial();
export type WorkstationPreferenceValues = z.infer<typeof valuesSchema>;
export type WorkstationPreferencePatch = z.infer<typeof patchSchema>;
export interface WorkstationPreferenceSnapshot {
	revision: number;
	invalid: boolean;
	values: WorkstationPreferenceValues;
}

function defaults(): WorkstationPreferenceValues {
	return {
		agentNativeInputEnabled: false,
		language: null,
		themeId: DEFAULT_THEME_ID,
		fontSettings: {},
		fileOpenMode: DEFAULT_FILE_OPEN_MODE,
		fileAutoSave: DEFAULT_FILE_AUTO_SAVE,
		confirmOnQuit: DEFAULT_CONFIRM_ON_QUIT,
		terminalCopyOnSelect: DEFAULT_TERMINAL_COPY_ON_SELECT,
	};
}

export class WorkstationPreferences {
	private readonly db: SqliteDatabase;
	constructor(database: string | SqliteDatabase) {
		this.db =
			typeof database === "string" ? new BetterSqlite(database) : database;
		if (typeof database === "string") chmodSync(database, 0o600);
		this.db.exec(
			"CREATE TABLE IF NOT EXISTS workstation_preferences (id INTEGER PRIMARY KEY CHECK (id = 1), schemaVersion INTEGER NOT NULL, revision INTEGER NOT NULL, data TEXT NOT NULL)",
		);
	}

	read(): WorkstationPreferenceSnapshot {
		const row = this.db
			.prepare(
				"SELECT schemaVersion, revision, data FROM workstation_preferences WHERE id = 1",
			)
			.get() as
			| { schemaVersion: number; revision: number; data: string }
			| undefined;
		if (!row) return { revision: 0, invalid: false, values: defaults() };
		const revision =
			Number.isSafeInteger(row.revision) && row.revision >= 0
				? row.revision
				: 0;
		if (
			row.schemaVersion !== 1 ||
			revision !== row.revision ||
			typeof row.data !== "string" ||
			Buffer.byteLength(row.data, "utf8") > MAX_PREFERENCES_BYTES
		)
			return { revision, invalid: true, values: defaults() };
		try {
			const values = valuesSchema.parse(JSON.parse(row.data));
			if (values.language !== null && !isSupportedLocale(values.language))
				throw new Error("Unsupported locale");
			return { revision, invalid: false, values };
		} catch {
			return { revision, invalid: true, values: defaults() };
		}
	}

	update(input: {
		expectedRevision: number;
		patch: WorkstationPreferencePatch;
	}): WorkstationPreferenceSnapshot {
		const expectedRevision = z
			.number()
			.int()
			.nonnegative()
			.max(Number.MAX_SAFE_INTEGER - 1)
			.parse(input.expectedRevision);
		const patch = patchSchema.parse(input.patch);
		this.db.exec("BEGIN IMMEDIATE");
		try {
			const current = this.read();
			if (current.invalid)
				throw new Error(
					"Workstation preferences are invalid; restore them explicitly before editing",
				);
			if (current.revision !== expectedRevision)
				throw new Error(
					"Workstation preferences changed; reload before editing",
				);
			const values = valuesSchema.parse({
				...current.values,
				...patch,
				fontSettings: {
					...current.values.fontSettings,
					...(patch.fontSettings
						? transformFontSettings(patch.fontSettings)
						: {}),
				},
			});
			const data = JSON.stringify(values);
			if (Buffer.byteLength(data, "utf8") > MAX_PREFERENCES_BYTES)
				throw new Error("Workstation preferences exceed their size limit");
			const revision = current.revision + 1;
			this.db
				.prepare(
					"INSERT INTO workstation_preferences (id, schemaVersion, revision, data) VALUES (1, 1, ?, ?) ON CONFLICT(id) DO UPDATE SET revision = excluded.revision, data = excluded.data",
				)
				.run(revision, data);
			this.db.exec("COMMIT");
			return { revision, invalid: false, values };
		} catch (error) {
			this.db.exec("ROLLBACK");
			throw error;
		}
	}

	close(): void {
		this.db.close();
	}
}

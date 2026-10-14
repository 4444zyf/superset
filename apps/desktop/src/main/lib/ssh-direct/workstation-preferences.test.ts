import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import type { SqliteDatabase } from "@superset/direct-connection";
import { WorkstationPreferences } from "./workstation-preferences";

function fixture() {
	const db = new Database(":memory:");
	return {
		db,
		store: new WorkstationPreferences(db as unknown as SqliteDatabase),
	};
}

test("a new workstation uses the original file defaults and leaves native Agent input off", () => {
	const f = fixture();
	try {
		const snapshot = f.store.read();
		expect(snapshot.revision).toBe(0);
		expect(snapshot.invalid).toBe(false);
		expect(snapshot.values.agentNativeInputEnabled).toBe(false);
		expect(snapshot.values.fontSettings).toEqual({});
	} finally {
		f.db.close();
	}
});

test("preference changes survive controller recreation and merge font patches without dropping other values", () => {
	const f = fixture();
	try {
		f.store.update({
			expectedRevision: 0,
			patch: {
				fontSettings: { terminalFontSize: 18 },
				agentNativeInputEnabled: true,
			},
		});
		const second = new WorkstationPreferences(
			f.db as unknown as SqliteDatabase,
		);
		const result = second.update({
			expectedRevision: 1,
			patch: { fontSettings: { editorFontSize: 16 } },
		});
		expect(result.values.fontSettings).toMatchObject({
			terminalFontSize: 18,
			editorFontSize: 16,
		});
		expect(result.values.agentNativeInputEnabled).toBe(true);
		expect(result.revision).toBe(2);
	} finally {
		f.db.close();
	}
});

test("a stale preference editor cannot overwrite a newer revision", () => {
	const f = fixture();
	try {
		f.store.update({ expectedRevision: 0, patch: { language: "zh-CN" } });
		expect(() =>
			f.store.update({ expectedRevision: 0, patch: { language: "en" } }),
		).toThrow("changed");
		expect(f.store.read().values.language).toBe("zh-CN");
	} finally {
		f.db.close();
	}
});

test("corrupt preferences disable experimental input without replacing the original bytes", () => {
	const f = fixture();
	try {
		f.store.update({
			expectedRevision: 0,
			patch: { agentNativeInputEnabled: true },
		});
		f.db.exec(
			"UPDATE workstation_preferences SET data = 'broken' WHERE id = 1",
		);
		expect(f.store.read()).toMatchObject({
			invalid: true,
			values: { agentNativeInputEnabled: false },
		});
		expect(() =>
			f.store.update({
				expectedRevision: 1,
				patch: { agentNativeInputEnabled: true },
			}),
		).toThrow("invalid");
		expect(
			f.db.query("SELECT data FROM workstation_preferences WHERE id = 1").get(),
		).toEqual({ data: "broken" });
	} finally {
		f.db.close();
	}
});

test("unknown future settings and coercible flags cannot activate native input", () => {
	const f = fixture();
	try {
		expect(() =>
			f.store.update({
				expectedRevision: 0,
				patch: { agentNativeInputEnabled: "false" } as never,
			}),
		).toThrow();
		expect(() =>
			f.store.update({
				expectedRevision: 0,
				patch: { apiKey: "must not persist" } as never,
			}),
		).toThrow();
		f.store.update({ expectedRevision: 0, patch: { language: "ja" } });
		f.db.exec(
			"UPDATE workstation_preferences SET schemaVersion = 99 WHERE id = 1",
		);
		expect(f.store.read()).toMatchObject({
			invalid: true,
			values: { agentNativeInputEnabled: false },
		});
		expect(() =>
			f.store.update({ expectedRevision: 1, patch: { language: "en" } }),
		).toThrow("invalid");
	} finally {
		f.db.close();
	}
});

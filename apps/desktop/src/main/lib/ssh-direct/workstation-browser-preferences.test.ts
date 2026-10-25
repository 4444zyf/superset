import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { defaultBrowserPreferenceValues } from "../../../shared/workstation-browser-preferences";
import { WorkstationBrowserPreferences } from "./workstation-browser-preferences";

test("browser defaults preserve the original tier mapping and settings survive reopening the same database", () => {
	const db = new Database(":memory:");
	const store = new WorkstationBrowserPreferences(db);
	expect(store.read()).toEqual({
		schemaVersion: 1,
		revision: 0,
		invalid: false,
		values: defaultBrowserPreferenceValues(),
	});
	expect(store.read().values.urlLinks).toEqual({
		plain: null,
		shift: "newTab",
		meta: "pane",
		metaShift: "external",
	});
	const saved = store.update({
		expectedRevision: 0,
		patch: {
			homepageUrl: " http://localhost:3000/中文?q=1#part ",
			portOpenAction: "newTab",
		},
	});
	expect(saved.values.homepageUrl).toBe("http://localhost:3000/中文?q=1#part");
	expect(new WorkstationBrowserPreferences(db).read()).toEqual(saved);
	expect(() =>
		store.update({ expectedRevision: 0, patch: { homepageUrl: null } }),
	).toThrow("revision");
	expect(store.read()).toEqual(saved);
	db.close();
});

test("invalid or future preferences require an explicit reset and cannot be silently overwritten", () => {
	const db = new Database(":memory:");
	const store = new WorkstationBrowserPreferences(db);
	store.update({ expectedRevision: 0, patch: { portOpenAction: "pane" } });
	db.exec("UPDATE workstation_browser_preferences SET schemaVersion=99");
	expect(store.read().invalid).toBe(true);
	expect(() =>
		store.update({ expectedRevision: 1, patch: { homepageUrl: null } }),
	).toThrow("invalid");
	expect(() => store.reset({ expectedRevision: 0 })).toThrow("revision");
	expect(store.reset({ expectedRevision: 1 }).values).toEqual(
		defaultBrowserPreferenceValues(),
	);
	expect(store.read().invalid).toBe(false);
	db.close();
});

test("unsupported actions and oversized values do not change saved browser preferences", () => {
	const db = new Database(":memory:");
	const store = new WorkstationBrowserPreferences(db);
	const before = store.read();
	expect(() =>
		store.update({
			expectedRevision: 0,
			patch: { portOpenAction: "rightPane" as never },
		}),
	).toThrow();
	expect(() =>
		store.update({
			expectedRevision: 0,
			patch: { homepageUrl: "x".repeat(8193) },
		}),
	).toThrow();
	expect(store.read()).toEqual(before);
	db.close();
});

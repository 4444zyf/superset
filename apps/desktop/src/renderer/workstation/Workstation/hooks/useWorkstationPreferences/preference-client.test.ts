import { expect, test } from "bun:test";
import type { WorkstationPreferenceSnapshot } from "../../../../../shared/workstation-preferences";
import { PreferenceClient } from "./preference-client";

const snapshot: WorkstationPreferenceSnapshot = {
	revision: 0,
	invalid: false,
	values: {
		agentNativeInputEnabled: false,
		language: null,
		themeId: "dark",
		fontSettings: {},
		fileOpenMode: "split-pane",
		fileAutoSave: "off",
		confirmOnQuit: true,
		terminalCopyOnSelect: false,
	},
};

test("a synchronous IPC failure can be retried with a new read", async () => {
	let reads = 0;
	const client = new PreferenceClient({
		getPreferences: () => {
			if (++reads === 1) throw new Error("IPC not ready");
			return Promise.resolve(snapshot);
		},
	});
	await expect(client.load()).rejects.toThrow("IPC not ready");
	await client.load();
	expect(reads).toBe(2);
	expect(client.getSnapshot().snapshot).toEqual(snapshot);
});

test("a stale refresh cannot replace an accepted newer preference revision", async () => {
	let finish!: (value: WorkstationPreferenceSnapshot) => void;
	let reads = 0;
	const next = {
		...snapshot,
		revision: 1,
		values: { ...snapshot.values, agentNativeInputEnabled: true },
	};
	const client = new PreferenceClient({
		getPreferences: async () =>
			++reads === 1
				? snapshot
				: new Promise((resolve) => {
						finish = resolve;
					}),
		updatePreferences: async () => next,
	});
	await client.load();
	const refresh = client.load();
	await client.update({ agentNativeInputEnabled: true });
	finish(snapshot);
	await refresh;
	expect(client.getSnapshot().snapshot).toEqual(next);
});

test("concurrent edits send one CAS update and retain the acknowledged values", async () => {
	let finish!: (value: WorkstationPreferenceSnapshot) => void;
	const calls: unknown[] = [];
	const client = new PreferenceClient({
		getPreferences: async () => snapshot,
		updatePreferences: async (input) => {
			calls.push(input);
			return new Promise((resolve) => {
				finish = resolve;
			});
		},
	});
	await client.load();
	const first = client.update({ language: "ja" });
	await expect(client.update({ language: "zh-CN" })).rejects.toThrow(
		"progress",
	);
	expect(calls).toEqual([{ expectedRevision: 0, patch: { language: "ja" } }]);
	finish({
		...snapshot,
		revision: 1,
		values: { ...snapshot.values, language: "ja" },
	});
	await first;
	expect(client.getSnapshot().snapshot?.values.language).toBe("ja");
});

test("a lost update reply triggers only a read, never another preference mutation", async () => {
	let writes = 0;
	let reads = 0;
	const committed = {
		...snapshot,
		revision: 1,
		values: { ...snapshot.values, language: "ja" as const },
	};
	const client = new PreferenceClient({
		getPreferences: async () => (++reads === 1 ? snapshot : committed),
		updatePreferences: async () => {
			writes++;
			throw new Error("Reply lost");
		},
	});
	await client.load();
	await expect(client.update({ language: "ja" })).rejects.toThrow("Reply lost");
	expect(writes).toBe(1);
	expect(reads).toBe(2);
	expect(client.getSnapshot().snapshot).toEqual(committed);
});

test("a disposed preference client cannot notify a replacement window", async () => {
	let finish!: (value: WorkstationPreferenceSnapshot) => void;
	const client = new PreferenceClient({
		getPreferences: () =>
			new Promise((resolve) => {
				finish = resolve;
			}),
	});
	let notifications = 0;
	client.subscribe(() => {
		notifications++;
	});
	const read = client.load();
	client.dispose();
	const count = notifications;
	finish(snapshot);
	await read;
	expect(notifications).toBe(count);
});

test("reconciliation after a lost reply reads again after an older refresh finishes", async () => {
	let finish!: (value: WorkstationPreferenceSnapshot) => void;
	let reads = 0;
	let writes = 0;
	const committed = {
		...snapshot,
		revision: 1,
		values: { ...snapshot.values, themeId: "light" },
	};
	const client = new PreferenceClient({
		getPreferences: async () => {
			reads++;
			if (reads === 1) return snapshot;
			if (reads === 2)
				return new Promise((resolve) => {
					finish = resolve;
				});
			return committed;
		},
		updatePreferences: async () => {
			writes++;
			throw new Error("Reply lost");
		},
	});
	await client.load();
	const refresh = client.load();
	const update = client.update({ themeId: "light" });
	await Promise.resolve();
	finish(snapshot);
	await refresh;
	await expect(update).rejects.toThrow("Reply lost");
	expect(reads).toBe(3);
	expect(writes).toBe(1);
	expect(client.getSnapshot().snapshot).toEqual(committed);
});

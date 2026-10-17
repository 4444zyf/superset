import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import type { SqliteDatabase } from "@superset/direct-connection";
import { WorkstationChatDrafts } from "./workstation-chat-drafts";

const identity = {
	connectionId: "machine",
	backendId: "backend",
	namespaceId: "namespace",
	workspaceId: "workspace",
	sessionId: "session",
};
const entry = {
	identity,
	value: {
		text: "未发送的草稿 🙂\n",
		attachments: [
			{ attachmentId: "opaque-upload", mediaType: "image/png", sizeBytes: 14 },
		],
	},
};
test("private SQLite draft snapshots retain attachment references and prevent an old write from reviving a cleared draft", () => {
	const db = new Database(":memory:");
	const store = new WorkstationChatDrafts(db as unknown as SqliteDatabase);
	try {
		expect(store.read()).toEqual({ revision: 0, invalid: false, entries: [] });
		const first = store.update({ expectedRevision: 0, entries: [entry] });
		expect(first.entries).toEqual([entry]);
		const clear = store.update({
			expectedRevision: first.revision,
			entries: [],
		});
		expect(clear.entries).toEqual([]);
		expect(() =>
			store.update({ expectedRevision: first.revision, entries: [entry] }),
		).toThrow("changed");
		expect(store.read()).toEqual(clear);
	} finally {
		store.close();
	}
});
test("draft storage rejects excess entries, duplicate identities and non UTF-8 byte bounds without changing existing data", () => {
	const db = new Database(":memory:");
	const store = new WorkstationChatDrafts(db as unknown as SqliteDatabase);
	try {
		store.update({ expectedRevision: 0, entries: [entry] });
		expect(() =>
			store.update({ expectedRevision: 1, entries: [entry, entry] }),
		).toThrow();
		expect(() =>
			store.update({
				expectedRevision: 1,
				entries: Array.from({ length: 33 }, (_, i) => ({
					...entry,
					identity: { ...identity, sessionId: String(i) },
				})),
			}),
		).toThrow();
		expect(() =>
			store.update({
				expectedRevision: 1,
				entries: [
					{ ...entry, value: { text: "中".repeat(400000), attachments: [] } },
				],
			}),
		).toThrow();
		expect(store.read().entries).toEqual([entry]);
	} finally {
		store.close();
	}
});

test("invalid stored draft data is reported and cannot be silently replaced by an empty snapshot", () => {
	const db = new Database(":memory:");
	const store = new WorkstationChatDrafts(db as unknown as SqliteDatabase);
	try {
		store.update({ expectedRevision: 0, entries: [entry] });
		db.exec(
			"UPDATE workstation_chat_drafts SET data='invalid-json' WHERE id=1",
		);
		expect(store.read()).toEqual({ revision: 1, invalid: true, entries: [] });
		expect(() => store.update({ expectedRevision: 1, entries: [] })).toThrow(
			"invalid",
		);
		expect(db.query("SELECT data FROM workstation_chat_drafts").get()).toEqual({
			data: "invalid-json",
		});
	} finally {
		store.close();
	}
});

test("persisted draft guards protect a connection and the exact workspace until the draft is explicitly cleared", () => {
	const db = new Database(":memory:");
	const store = new WorkstationChatDrafts(db as unknown as SqliteDatabase);
	try {
		store.update({ expectedRevision: 0, entries: [entry] });
		expect(store.hasDrafts({ connectionId: identity.connectionId })).toBe(true);
		expect(store.hasDrafts({ ...identity, namespaceId: "other" })).toBe(false);
		store.update({ expectedRevision: 1, entries: [] });
		expect(store.hasDrafts({ connectionId: identity.connectionId })).toBe(
			false,
		);
	} finally {
		store.close();
	}
});

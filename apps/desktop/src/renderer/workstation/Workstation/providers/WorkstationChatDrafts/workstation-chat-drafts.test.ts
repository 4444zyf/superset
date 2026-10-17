import { expect, test } from "bun:test";
import type {
	WorkstationChatDraftSnapshot,
	WorkstationChatDraftUpdate,
} from "../../../../../shared/workstation-chat-drafts";
import { WorkstationChatDraftStore } from "./workstation-chat-drafts";

const identity = {
	connectionId: "machine",
	backendId: "backend",
	namespaceId: "namespace",
	workspaceId: "workspace",
	sessionId: "first",
};
const empty = (): WorkstationChatDraftSnapshot => ({
	revision: 0,
	invalid: false,
	entries: [],
});
const noTimer = () => () => {};
test("late draft hydration preserves text typed meanwhile and other persisted sessions without crossing namespaces", async () => {
	let loaded!: (value: WorkstationChatDraftSnapshot) => void;
	let snapshot = empty();
	const writes: WorkstationChatDraftUpdate[] = [];
	const store = new WorkstationChatDraftStore(
		{
			getChatDrafts: () =>
				new Promise((resolve) => {
					loaded = resolve;
				}),
			saveChatDrafts: async (input) => {
				writes.push(input);
				snapshot = {
					revision: snapshot.revision + 1,
					invalid: false,
					entries: input.entries,
				};
				return snapshot;
			},
		},
		noTimer,
	);
	const starting = store.start();
	store.change(identity, {
		text: "typed before read reply 中文",
		attachments: [],
	});
	snapshot = {
		revision: 4,
		invalid: false,
		entries: [
			{ identity, value: { text: "stale stored first", attachments: [] } },
			{
				identity: { ...identity, sessionId: "second" },
				value: { text: "other saved draft", attachments: [] },
			},
		],
	};
	loaded(snapshot);
	await starting;
	await store.flush();
	expect(store.get(identity).text).toBe("typed before read reply 中文");
	expect(store.get({ ...identity, sessionId: "second" }).text).toBe(
		"other saved draft",
	);
	expect(store.get({ ...identity, namespaceId: "other" }).text).toBe("");
	expect(writes).toHaveLength(1);
	expect(writes[0]?.expectedRevision).toBe(4);
	store.stop();
});
test("draft writes serialize and a late acknowledgement cannot clear a newer staged draft", async () => {
	const timers = new Set<() => void>();
	let finish!: (value: WorkstationChatDraftSnapshot) => void;
	const writes: WorkstationChatDraftUpdate[] = [];
	const store = new WorkstationChatDraftStore(
		{
			getChatDrafts: async () => empty(),
			saveChatDrafts: async (input) => {
				writes.push(input);
				return writes.length === 1
					? new Promise((resolve) => {
							finish = resolve;
						})
					: { revision: 2, invalid: false, entries: input.entries };
			},
		},
		(callback) => {
			timers.add(callback);
			return () => {
				timers.delete(callback);
			};
		},
	);
	await store.start();
	store.change(identity, { text: "first", attachments: [] });
	const pending = store.flush();
	for (let i = 0; i < 5; i++) await Promise.resolve();
	store.change(identity, { text: "second", attachments: [] });
	store.change(identity, { text: "latest", attachments: [] });
	expect(writes).toHaveLength(1);
	finish({ revision: 1, invalid: false, entries: writes[0]!.entries });
	await pending;
	expect(writes).toHaveLength(2);
	expect(writes[1]?.expectedRevision).toBe(1);
	expect(writes[1]?.entries[0]?.value.text).toBe("latest");
	expect(store.get(identity).text).toBe("latest");
	expect(timers.size).toBe(0);
	store.stop();
});
test("failed draft persistence keeps the in-memory message and attachment references for an explicit retry", async () => {
	let fail = true;
	const writes: WorkstationChatDraftUpdate[] = [];
	const store = new WorkstationChatDraftStore(
		{
			getChatDrafts: async () => empty(),
			saveChatDrafts: async (input) => {
				writes.push(input);
				if (fail) throw new Error("Disk full");
				return { revision: 1, invalid: false, entries: input.entries };
			},
		},
		noTimer,
	);
	await store.start();
	const draft = {
		text: "keep this",
		attachments: [
			{ attachmentId: "opaque", mediaType: "image/png", sizeBytes: 4 },
		],
	};
	store.change(identity, draft);
	await expect(store.flush()).rejects.toThrow("Disk full");
	expect(store.get(identity)).toEqual(draft);
	expect(writes).toHaveLength(1);
	fail = false;
	await store.flush();
	expect(writes).toHaveLength(2);
	expect(writes[1]?.expectedRevision).toBe(0);
	expect(store.error).toBeNull();
	store.stop();
});

test("workspace draft guards stay scoped and clear only after the last reference or text is explicitly discarded", async () => {
	const store = new WorkstationChatDraftStore({}, noTimer);
	const target = {
		connectionId: identity.connectionId,
		backendId: identity.backendId,
		namespaceId: identity.namespaceId,
		workspaceId: identity.workspaceId,
	};
	store.change(identity, {
		text: "",
		attachments: [
			{ attachmentId: "image", mediaType: "image/png", sizeBytes: 7 },
		],
	});
	store.change(
		{ ...identity, namespaceId: "other" },
		{ text: "another namespace", attachments: [] },
	);
	expect(store.hasDrafts(target)).toBe(true);
	expect(store.hasDrafts({ ...target, workspaceId: "different" })).toBe(false);
	store.change(identity, { text: "", attachments: [] });
	await store.flush();
	expect(store.hasDrafts(target)).toBe(false);
	expect(store.hasDrafts({ ...target, namespaceId: "other" })).toBe(true);
	store.stop();
});

test("a failed explicit discard restores its message and stops automatic retries until another user action", async () => {
	let fail = false;
	let revision = 0;
	let calls = 0;
	const timers = new Set<() => void>();
	const store = new WorkstationChatDraftStore(
		{
			getChatDrafts: async () => empty(),
			saveChatDrafts: async (input) => {
				calls++;
				if (fail) throw new Error("Disk full");
				return { revision: ++revision, invalid: false, entries: input.entries };
			},
		},
		(callback) => {
			timers.add(callback);
			return () => {
				timers.delete(callback);
			};
		},
	);
	await store.start();
	store.change(identity, {
		text: "do not lose me on a failed discard",
		attachments: [],
	});
	await store.flush();
	fail = true;
	await expect(store.discard(identity)).rejects.toThrow("Disk full");
	expect(store.get(identity).text).toBe("do not lose me on a failed discard");
	expect(calls).toBe(2);
	expect(timers.size).toBe(0);
	fail = false;
	await store.discard(identity);
	expect(store.get(identity).text).toBe("");
	expect(calls).toBe(3);
	store.stop();
});

test("offline draft review includes replaced backends and removed sessions, with exact target filtering", async () => {
	const entries = [
		{ identity, value: { text: "old backend", attachments: [] } },
		{
			identity: {
				...identity,
				backendId: "replacement",
				sessionId: "missing-session",
			},
			value: { text: "orphaned draft", attachments: [] },
		},
		{
			identity: { ...identity, connectionId: "other" },
			value: { text: "other machine", attachments: [] },
		},
	];
	const store = new WorkstationChatDraftStore(
		{ getChatDrafts: async () => ({ revision: 4, invalid: false, entries }) },
		noTimer,
	);
	await store.start();
	expect(store.list()).toEqual(entries);
	expect(store.list({ connectionId: "machine" })).toEqual(entries.slice(0, 2));
	expect(
		store.list({
			...identity,
			backendId: "replacement",
			sessionId: "missing-session",
		}),
	).toEqual([entries[1]]);
	expect(store.list({ ...identity, namespaceId: "unrelated" })).toEqual([]);
	store.stop();
});

test("an explicit discard of a reviewed draft cannot delete newer text or references", async () => {
	const store = new WorkstationChatDraftStore({}, noTimer);
	const reviewed = { text: "reviewed", attachments: [] };
	store.change(identity, reviewed);
	const newer = {
		text: "new edit arrived",
		attachments: [
			{ attachmentId: "late", mediaType: "text/plain", sizeBytes: 5 },
		],
	};
	store.change(identity, newer);
	expect(await store.discard(identity, reviewed)).toBe(false);
	expect(store.get(identity)).toEqual(newer);
	await store.flush();
	expect(await store.discard(identity, store.get(identity))).toBe(true);
	expect(store.get(identity).text).toBe("");
	store.stop();
});

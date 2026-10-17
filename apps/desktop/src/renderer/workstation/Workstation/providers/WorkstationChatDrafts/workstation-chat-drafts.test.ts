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

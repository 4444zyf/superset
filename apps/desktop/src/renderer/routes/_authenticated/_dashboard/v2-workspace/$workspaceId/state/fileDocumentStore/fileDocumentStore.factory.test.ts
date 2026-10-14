import { expect, test } from "bun:test";
import {
	createFileDocumentStore,
	type DocumentFilesystemClient,
} from "./fileDocumentStore";

function client(text: string): DocumentFilesystemClient {
	return {
		filesystem: {
			readFile: {
				query: async () => ({
					kind: "text",
					content: text,
					revision: "r1",
					exceededLimit: false,
					byteLength: text.length,
				}),
			},
			writeFile: { mutate: async () => ({ ok: true, revision: "r2" }) },
		},
	};
}
const settle = async () => {
	for (let i = 0; i < 5; i++) await Promise.resolve();
};

test("separate backend document stores isolate identical workspace IDs and paths", async () => {
	const first = createFileDocumentStore();
	const second = createFileDocumentStore();
	const a = first.acquireDocument(
		"workspace",
		"/repo/note.txt",
		client("first backend"),
	);
	const b = second.acquireDocument(
		"workspace",
		"/repo/note.txt",
		client("second backend"),
	);
	await settle();
	expect(a.content).toMatchObject({ kind: "text", value: "first backend" });
	expect(b.content).toMatchObject({ kind: "text", value: "second backend" });
	a.setContent("retained first draft");
	first.releaseDocument("workspace", "/repo/note.txt");
	const restored = first.acquireDocument(
		"workspace",
		"/repo/note.txt",
		client("must not reload"),
	);
	expect(restored.id).toBe(a.id);
	expect(restored.content).toMatchObject({ value: "retained first draft" });
	expect(b.content).toMatchObject({ value: "second backend" });
});

test("a new store can use a bounded read without changing the original default", async () => {
	const limits: Array<number | undefined> = [];
	const transport: DocumentFilesystemClient = {
		filesystem: {
			...client("").filesystem,
			readFile: {
				query: async (input) => {
					limits.push(input.maxBytes);
					return {
						kind: "text",
						content: "",
						revision: "r1",
						exceededLimit: false,
						byteLength: 0,
					};
				},
			},
		},
	};
	createFileDocumentStore({ maxBytes: 1024 }).acquireDocument(
		"workspace",
		"/repo/limited.txt",
		transport,
	);
	createFileDocumentStore().acquireDocument(
		"workspace",
		"/repo/default.txt",
		transport,
	);
	await settle();
	expect(limits).toEqual([1024, 10 * 1024 * 1024]);
});

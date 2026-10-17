import { expect, test } from "bun:test";
import { ClaudeAdapter, type ClaudeQuery } from "./claudeAdapter";

test("Claude receives resolved SSH image bytes instead of just the pasted filename", async () => {
	let capture!: (params: Parameters<ClaudeQuery>[0]) => void;
	const params = new Promise<Parameters<ClaudeQuery>[0]>((resolve) => {
		capture = resolve;
	});
	let finish!: () => void;
	const closed = new Promise<void>((resolve) => {
		finish = resolve;
	});
	const data = "iVBORw0KGgo=";
	const resolved: string[] = [];
	const adapter = new ClaudeAdapter({
		query(input) {
			capture(input);
			return {
				[Symbol.asyncIterator]() {
					return {
						next: async () => {
							await closed;
							return { done: true, value: undefined };
						},
					};
				},
			};
		},
		resolveAttachment: async (id) => {
			resolved.push(id);
			if (id === "note")
				return {
					path: "/remote/private/notes.txt",
					mimeType: "text/plain",
					data: "YWJj",
				};
			return {
				path: "/remote/private/upload.png",
				mimeType: "image/png",
				data,
			};
		},
	});
	try {
		adapter.start({ cwd: "/remote/project" });
		adapter.prompt([
			{ type: "text", text: "看这张图 🙂" },
			{
				type: "attachment",
				attachmentId: "opaque-id",
				name: "image.png",
				mimeType: "text/plain",
			},
			{
				type: "attachment",
				attachmentId: "note",
				name: "中文 note.txt",
				mimeType: "image/png",
			},
		]);
		const input = (await params).prompt;
		if (typeof input === "string")
			throw new Error("Expected original streaming prompt");
		const message = await input[Symbol.asyncIterator]().next();
		expect(message.value.message.content).toEqual([
			{ type: "text", text: "看这张图 🙂" },
			{
				type: "image",
				source: { type: "base64", media_type: "image/png", data },
			},
			{
				type: "text",
				text: 'Attachment "中文 note.txt": "/remote/private/notes.txt"',
			},
		]);
		expect(resolved).toEqual(["opaque-id", "note"]);
	} finally {
		finish();
		await adapter.dispose();
	}
});

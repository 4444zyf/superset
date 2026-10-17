import { expect, test } from "bun:test";
import { CodexAdapter } from "./codexAdapter";

test("a resolved SSH image reaches Codex as an image input alongside the unchanged text", async () => {
	let capture!: (value: unknown) => void;
	const request = new Promise<unknown>((resolve) => {
		capture = resolve;
	});
	const resolved: string[] = [];
	const data = "iVBORw0KGgo=";
	const adapter = new CodexAdapter({
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
		createTransport: (_options, handlers) => ({
			send(line) {
				const frame = JSON.parse(line);
				if (frame.method === "initialize")
					handlers.onLine(
						JSON.stringify({
							id: frame.id,
							result: { userAgent: "codex/0.160.0" },
						}),
					);
				if (frame.method === "thread/start")
					handlers.onLine(
						JSON.stringify({
							id: frame.id,
							result: { thread: { id: "thread" } },
						}),
					);
				if (frame.method === "turn/start") {
					capture(frame.params.input);
					handlers.onLine(
						JSON.stringify({
							id: frame.id,
							result: { turn: { id: "turn", status: "inProgress" } },
						}),
					);
				}
			},
			close: async () => {},
		}),
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
		expect(await request).toEqual([
			{ type: "text", text: "看这张图 🙂", text_elements: [] },
			{ type: "image", url: `data:image/png;base64,${data}` },
			{
				type: "text",
				text: 'Attachment "中文 note.txt": "/remote/private/notes.txt"',
				text_elements: [],
			},
		]);
		expect(resolved).toEqual(["opaque-id", "note"]);
	} finally {
		await adapter.dispose();
	}
});

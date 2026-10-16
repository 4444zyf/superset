import { expect, test } from "bun:test";
import superjson from "superjson";
import { uploadClipboardAttachment } from "./clipboard-attachment";

test("clipboard bytes use the selected generation and the existing attachment upload", async () => {
	const checked: unknown[] = [];
	const requests: unknown[] = [];
	const result = await uploadClipboardAttachment(
		{
			assertGeneration: (...args: unknown[]) => {
				checked.push(args);
			},
		},
		{
			request: async (id: string, request: unknown) => {
				requests.push({ id, request });
				return Response.json({
					result: {
						data: superjson.serialize({
							attachmentId: "fe9b201a-ed19-4310-862b-d3cb9fca7d32",
							mediaType: "image/png",
							sizeBytes: 3,
						}),
					},
				});
			},
		},
		{
			connectionId: "fe9b201a-ed19-4310-862b-d3cb9fca7d32",
			generation: 2,
			bytes: new Uint8Array([1, 2, 3]),
			fileName: "image.png",
			mimeType: "image/png",
		},
	);
	expect(checked).toHaveLength(2);
	expect(result.sizeBytes).toBe(3);
	expect(requests).toHaveLength(1);
});
test("invalid clipboard size never contacts a backend", async () => {
	let requests = 0;
	await expect(
		uploadClipboardAttachment(
			{ assertGeneration() {} },
			{
				request: async () => {
					requests++;
					return Response.json({});
				},
			},
			{
				connectionId: "fe9b201a-ed19-4310-862b-d3cb9fca7d32",
				generation: 2,
				bytes: new Uint8Array(25 * 1024 * 1024 + 1),
				fileName: "large.png",
				mimeType: "image/png",
			},
		),
	).rejects.toThrow();
	expect(requests).toBe(0);
});

test("an upload reply from an old generation is rejected without retry", async () => {
	let checks = 0,
		requests = 0;
	await expect(
		uploadClipboardAttachment(
			{
				assertGeneration() {
					if (++checks === 2) throw new Error("changed");
				},
			},
			{
				request: async () => {
					requests++;
					return Response.json({
						result: {
							data: superjson.serialize({
								attachmentId: "fe9b201a-ed19-4310-862b-d3cb9fca7d32",
								mediaType: "image/png",
								sizeBytes: 1,
							}),
						},
					});
				},
			},
			{
				connectionId: "fe9b201a-ed19-4310-862b-d3cb9fca7d32",
				generation: 2,
				bytes: new Uint8Array([1]),
				fileName: "image.png",
				mimeType: "image/png",
			},
		),
	).rejects.toThrow("changed");
	expect(requests).toBe(1);
});

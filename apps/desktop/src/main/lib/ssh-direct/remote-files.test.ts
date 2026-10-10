import { expect, test } from "bun:test";
import superjson from "superjson";
import { readRemoteAttachment, uploadSelectedAttachment } from "./remote-files";

const connection = {
	connectionId: "mini",
	generation: 3,
	backendId: "b",
	namespaceId: "n",
	instanceId: "i",
};
const attachmentId = "fe9b201a-ed19-4310-862b-d3cb9fca7d32";

test("selected attachment bytes upload to B through the existing attachment procedure", async () => {
	const calls: unknown[] = [];
	const manager = {
		request: async (id: string, request: unknown) => {
			calls.push({ id, request });
			return Response.json({
				result: {
					data: superjson.serialize({
						attachmentId,
						originalFilename: "note.txt",
						mediaType: "text/plain",
						sizeBytes: 5,
					}),
				},
			});
		},
	};
	const uploaded = await uploadSelectedAttachment(manager, connection, {
		bytes: new TextEncoder().encode("hello"),
		fileName: "note.txt",
		mimeType: "text/plain",
	});
	expect(uploaded.attachmentId).toBe(attachmentId);
	const call = calls[0] as {
		id: string;
		request: { path: string; method: string; body: string };
	};
	expect(call.id).toBe("mini");
	expect(call.request.path).toBe("/trpc/attachments.upload");
	expect(superjson.parse<Record<string, unknown>>(call.request.body)).toEqual({
		data: { kind: "base64", data: "aGVsbG8=" },
		mediaType: "text/plain",
		originalFilename: "note.txt",
	});
});

test("oversized selected uploads fail before contacting the backend", async () => {
	let calls = 0;
	const manager = {
		request: async () => {
			calls++;
			return Response.json({});
		},
	};
	await expect(
		uploadSelectedAttachment(manager, connection, {
			bytes: new Uint8Array(25 * 1024 * 1024 + 1),
			fileName: "large.bin",
			mimeType: "application/octet-stream",
		}),
	).rejects.toThrow("25 MiB");
	expect(calls).toBe(0);
});

test("attachment uploads surface backend errors without retrying", async () => {
	let calls = 0;
	const manager = {
		request: async () => {
			calls++;
			return Response.json(
				{ error: superjson.serialize({ message: "Disk full" }) },
				{ status: 507 },
			);
		},
	};
	await expect(
		uploadSelectedAttachment(manager, connection, {
			bytes: new Uint8Array([1]),
			fileName: "a",
			mimeType: "application/octet-stream",
		}),
	).rejects.toThrow("Disk full");
	expect(calls).toBe(1);
});

test("attachment reads accept opaque ids rather than remote paths", async () => {
	const paths: string[] = [];
	const manager = {
		request: async (_id: string, request: { path: string }) => {
			paths.push(request.path);
			return new Response(new Uint8Array([1, 2]), {
				headers: {
					"Content-Type": "image/png",
					"X-Attachment-Filename": "photo.png",
				},
			});
		},
	};
	const result = await readRemoteAttachment(manager, connection, attachmentId);
	expect(paths).toEqual([`/attachments/${attachmentId}`]);
	expect(result).toEqual({
		bytes: new Uint8Array([1, 2]),
		mimeType: "image/png",
		fileName: "photo.png",
	});
	await expect(
		readRemoteAttachment(manager, connection, "../../.ssh/id_ed25519"),
	).rejects.toThrow("Invalid attachment ID");
	expect(paths).toHaveLength(1);
});

test("a dishonest download cannot allocate beyond the attachment size limit", async () => {
	let cancelled = false;
	const manager = {
		request: async () =>
			new Response(
				new ReadableStream({
					start(controller) {
						controller.enqueue(new Uint8Array(25 * 1024 * 1024 + 1));
					},
					cancel() {
						cancelled = true;
					},
				}),
				{ headers: { "Content-Length": "1" } },
			),
	};
	await expect(
		readRemoteAttachment(manager, connection, attachmentId),
	).rejects.toThrow("25 MiB");
	expect(cancelled).toBe(true);
});

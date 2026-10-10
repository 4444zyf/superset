import {
	closeSync,
	constants,
	createReadStream,
	fstatSync,
	openSync,
	realpathSync,
} from "node:fs";
import { sep } from "node:path";
import { Readable } from "node:stream";
import type { Hono } from "hono";
import { z } from "zod";
import { MAX_INLINE_ATTACHMENT_BYTES } from "../trpc/router/attachments/constants";
import {
	getAttachmentsRoot,
	resolveAttachmentPath,
} from "../trpc/router/attachments/storage";

export function registerDirectAttachmentRoute(
	app: Hono,
	hostDir: string,
): void {
	app.get("/attachments/:attachmentId", (c) => {
		const parsed = z.string().uuid().safeParse(c.req.param("attachmentId"));
		if (!parsed.success)
			return c.json({ error: "Expected an attachment UUID" }, 400);
		let fd: number | undefined;
		try {
			const attachment = resolveAttachmentPath(parsed.data, hostDir);
			if (!attachment) return c.json({ error: "Attachment not found" }, 404);
			const path = realpathSync(attachment.path);
			const root = realpathSync(getAttachmentsRoot(hostDir));
			if (!path.startsWith(root + sep))
				return c.json({ error: "Attachment not found" }, 404);
			fd = openSync(attachment.path, constants.O_RDONLY | constants.O_NOFOLLOW);
			const stat = fstatSync(fd);
			if (!stat.isFile()) return c.json({ error: "Attachment not found" }, 404);
			if (stat.size > MAX_INLINE_ATTACHMENT_BYTES)
				return c.json({ error: "Attachment exceeds the download limit" }, 413);
			const contentType = /^[a-z0-9.+-]+\/[a-z0-9.+-]+$/i.test(
				attachment.metadata.mediaType,
			)
				? attachment.metadata.mediaType
				: "application/octet-stream";
			if (stat.size === 0)
				return c.body(null, 200, {
					"Content-Type": contentType,
					"Content-Length": "0",
				});
			const stream = createReadStream(attachment.path, {
				fd,
				autoClose: true,
				start: 0,
				end: stat.size - 1,
			});
			fd = undefined;
			return new Response(
				Readable.toWeb(stream) as unknown as ReadableStream<Uint8Array>,
				{
					headers: {
						"Content-Type": contentType,
						"Content-Length": String(stat.size),
						"Cache-Control": "no-store",
						"X-Content-Type-Options": "nosniff",
					},
				},
			);
		} catch {
			return c.json({ error: "Attachment not found" }, 404);
		} finally {
			if (fd !== undefined) closeSync(fd);
		}
	});
}

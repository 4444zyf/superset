import {
	closeSync,
	constants,
	createReadStream,
	fstatSync,
	lstatSync,
	openSync,
	readSync,
	realpathSync,
} from "node:fs";
import { basename, sep } from "node:path";
import { Readable } from "node:stream";
import type { Hono } from "hono";
import { z } from "zod";
import { MAX_INLINE_ATTACHMENT_BYTES } from "../trpc/router/attachments/constants";
import {
	type AttachmentMetadata,
	getAttachmentDir,
	getAttachmentFilePath,
	getAttachmentMetadataPath,
	getAttachmentsRoot,
} from "../trpc/router/attachments/storage";

const MAX_METADATA_BYTES = 16 * 1024;
const metadataSchema = z.object({
	attachmentId: z.string().uuid(),
	mediaType: z.string().min(1).max(255),
	originalFilename: z.string().max(1024).optional(),
	sizeBytes: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
	createdAt: z.number().finite().nonnegative(),
});

function isOwnedPrivate(stat: { uid: number; mode: number }): boolean {
	return (
		(stat.mode & 0o077) === 0 &&
		(!process.getuid || stat.uid === process.getuid())
	);
}

function readDirectMetadata(
	attachmentId: string,
	hostDir: string,
): AttachmentMetadata {
	for (const directory of [
		getAttachmentsRoot(hostDir),
		getAttachmentDir(attachmentId, hostDir),
	]) {
		const stat = lstatSync(directory);
		if (!stat.isDirectory() || !isOwnedPrivate(stat))
			throw new Error("Attachment directory is not private");
	}
	const fd = openSync(
		getAttachmentMetadataPath(attachmentId, hostDir),
		constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
	);
	try {
		const stat = fstatSync(fd);
		if (
			!stat.isFile() ||
			!isOwnedPrivate(stat) ||
			stat.nlink !== 1 ||
			stat.size > MAX_METADATA_BYTES
		)
			throw new Error("Invalid attachment metadata file");
		const bytes = Buffer.alloc(MAX_METADATA_BYTES + 1);
		let length = 0;
		while (length < bytes.length) {
			const count = readSync(fd, bytes, length, bytes.length - length, length);
			if (count === 0) break;
			length += count;
		}
		if (length > MAX_METADATA_BYTES)
			throw new Error("Attachment metadata exceeds its limit");
		const metadata = metadataSchema.parse(
			JSON.parse(bytes.subarray(0, length).toString("utf8")),
		);
		if (metadata.attachmentId !== attachmentId)
			throw new Error("Attachment identity does not match");
		return metadata;
	} finally {
		closeSync(fd);
	}
}

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
			const metadata = readDirectMetadata(parsed.data, hostDir);
			const path = getAttachmentFilePath(
				parsed.data,
				metadata.mediaType,
				hostDir,
			);
			fd = openSync(
				path,
				constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
			);
			const stat = fstatSync(fd);
			if (!stat.isFile() || !isOwnedPrivate(stat) || stat.nlink !== 1)
				return c.json({ error: "Attachment not found" }, 404);
			const current = lstatSync(path);
			const root = realpathSync(getAttachmentsRoot(hostDir));
			if (
				current.isSymbolicLink() ||
				current.dev !== stat.dev ||
				current.ino !== stat.ino ||
				!realpathSync(path).startsWith(root + sep)
			)
				return c.json({ error: "Attachment not found" }, 404);
			if (stat.size > MAX_INLINE_ATTACHMENT_BYTES)
				return c.json({ error: "Attachment exceeds the download limit" }, 413);
			if (stat.size !== metadata.sizeBytes)
				return c.json({ error: "Attachment not found" }, 404);
			const contentType = /^[a-z0-9.+-]+\/[a-z0-9.+-]+$/i.test(
				metadata.mediaType,
			)
				? metadata.mediaType
				: "application/octet-stream";
			const headers = {
				"Content-Type": contentType,
				"Content-Length": String(stat.size),
				"Cache-Control": "no-store",
				"X-Content-Type-Options": "nosniff",
				"X-Attachment-Filename": encodeURIComponent(
					metadata.originalFilename || basename(path),
				),
			};
			if (stat.size === 0) return c.body(null, 200, headers);
			const stream = createReadStream(path, {
				fd,
				autoClose: true,
				start: 0,
				end: stat.size - 1,
			});
			fd = undefined;
			return new Response(
				Readable.toWeb(stream) as unknown as ReadableStream<Uint8Array>,
				{ headers },
			);
		} catch {
			return c.json({ error: "Attachment not found" }, 404);
		} finally {
			if (fd !== undefined) closeSync(fd);
		}
	});
}

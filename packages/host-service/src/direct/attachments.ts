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
import type { PromptAttachment } from "@superset/chat-runtime";
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

class AttachmentLimitError extends Error {}

function openDirectAttachment(attachmentId: string, hostDir: string) {
	const metadata = readDirectMetadata(attachmentId, hostDir);
	const path = getAttachmentFilePath(attachmentId, metadata.mediaType, hostDir);
	const fd = openSync(
		path,
		constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
	);
	try {
		const stat = fstatSync(fd);
		if (!stat.isFile() || !isOwnedPrivate(stat) || stat.nlink !== 1)
			throw new Error("Attachment not found");
		const current = lstatSync(path);
		const root = realpathSync(getAttachmentsRoot(hostDir));
		if (
			current.isSymbolicLink() ||
			current.dev !== stat.dev ||
			current.ino !== stat.ino ||
			!realpathSync(path).startsWith(root + sep)
		)
			throw new Error("Attachment not found");
		if (stat.size > MAX_INLINE_ATTACHMENT_BYTES)
			throw new AttachmentLimitError("Attachment exceeds the download limit");
		if (stat.size !== metadata.sizeBytes)
			throw new Error("Attachment not found");
		return { fd, metadata, path, stat };
	} catch (error) {
		closeSync(fd);
		throw error;
	}
}

export async function readDirectAttachmentForAgent(
	attachmentId: string,
	hostDir: string,
	signal: AbortSignal,
): Promise<PromptAttachment | null> {
	if (!z.string().uuid().safeParse(attachmentId).success) return null;
	let fd: number | undefined;
	try {
		signal.throwIfAborted();
		const opened = openDirectAttachment(attachmentId, hostDir);
		fd = opened.fd;
		if (!opened.stat.size) return null;
		const stream = createReadStream(opened.path, {
			fd,
			autoClose: true,
			start: 0,
			end: opened.stat.size - 1,
			signal,
		});
		fd = undefined;
		const chunks: Buffer[] = [];
		let length = 0;
		for await (const chunk of stream) {
			chunks.push(Buffer.from(chunk));
			length += chunk.length;
		}
		if (length !== opened.stat.size) return null;
		return {
			path: opened.path,
			mimeType: opened.metadata.mediaType,
			data: Buffer.concat(chunks, length).toString("base64"),
		};
	} catch (error) {
		if (signal.aborted) throw error;
		return null;
	} finally {
		if (fd !== undefined) closeSync(fd);
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
			const opened = openDirectAttachment(parsed.data, hostDir);
			const { metadata, path, stat } = opened;
			fd = opened.fd;
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
		} catch (error) {
			if (error instanceof AttachmentLimitError)
				return c.json({ error: error.message }, 413);
			return c.json({ error: "Attachment not found" }, 404);
		} finally {
			if (fd !== undefined) closeSync(fd);
		}
	});
}

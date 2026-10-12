import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { msg } from "@lingui/core/macro";
import { i18n } from "@superset/i18n";
import { MAX_ATTACHMENT_BYTES } from "./remote-files";

interface AttachmentFile {
	stat(): Promise<{ size: number; isFile(): boolean }>;
	read(
		buffer: Uint8Array,
		offset: number,
		length: number,
		position: number,
	): Promise<{ bytesRead: number }>;
	close(): Promise<void>;
}

export async function readSelectedAttachmentBytes(
	filePath: string,
	openFile: (filePath: string, flags: number) => Promise<AttachmentFile> = open,
): Promise<Uint8Array> {
	const file = await openFile(
		filePath,
		constants.O_RDONLY | constants.O_NONBLOCK,
	);
	try {
		const info = await file.stat();
		if (!info.isFile() || info.size < 1 || info.size > MAX_ATTACHMENT_BYTES)
			throw new Error(
				i18n._(msg({ message: "Choose a nonempty attachment up to 25 MiB" })),
			);
		const chunks: Uint8Array[] = [];
		let length = 0;
		for (;;) {
			const chunk = new Uint8Array(
				Math.min(64 * 1024, MAX_ATTACHMENT_BYTES - length + 1),
			);
			const { bytesRead } = await file.read(chunk, 0, chunk.byteLength, length);
			if (!bytesRead) break;
			length += bytesRead;
			if (length > MAX_ATTACHMENT_BYTES)
				throw new Error(i18n._(msg({ message: "Attachment exceeds 25 MiB" })));
			chunks.push(chunk.subarray(0, bytesRead));
		}
		if (!length)
			throw new Error(i18n._(msg({ message: "Attachment is empty" })));
		return Buffer.concat(chunks, length);
	} finally {
		await file.close();
	}
}

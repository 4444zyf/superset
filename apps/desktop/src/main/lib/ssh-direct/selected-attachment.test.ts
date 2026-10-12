import { expect, test } from "bun:test";
import { constants } from "node:fs";
import { MAX_ATTACHMENT_BYTES } from "./remote-files";
import { readSelectedAttachmentBytes } from "./selected-attachment";

function selectedFile(bytes: Uint8Array, reportedSize = bytes.byteLength) {
	let closed = false;
	let flags = -1;
	const file = {
		stat: async () => ({ size: reportedSize, isFile: () => true }),
		read: async (
			buffer: Uint8Array,
			offset: number,
			length: number,
			position: number,
		) => {
			const chunk = bytes.subarray(position, position + length);
			buffer.set(chunk, offset);
			return { bytesRead: chunk.byteLength };
		},
		close: async () => {
			closed = true;
		},
	};
	return {
		file,
		open: async (_path: string, options: number) => {
			flags = options;
			return file;
		},
		isClosed: () => closed,
		flags: () => flags,
	};
}

test("a selected FIFO cannot block attachment selection before descriptor validation", async () => {
	const f = selectedFile(new Uint8Array([1]));
	f.file.stat = async () => ({ size: 1, isFile: () => false });
	await expect(
		readSelectedAttachmentBytes("/selected", f.open),
	).rejects.toThrow("nonempty attachment");
	expect(f.flags() & constants.O_NONBLOCK).toBe(constants.O_NONBLOCK);
	expect(f.isClosed()).toBe(true);
});

test("a selected file that grows after stat cannot exceed the upload limit", async () => {
	const f = selectedFile(new Uint8Array(MAX_ATTACHMENT_BYTES + 1), 1);
	await expect(
		readSelectedAttachmentBytes("/selected", f.open),
	).rejects.toThrow("25 MiB");
	expect(f.isClosed()).toBe(true);
});

test("selection reads the opened descriptor and closes it after returning the actual bytes", async () => {
	const f = selectedFile(new Uint8Array([104, 105]));
	expect(await readSelectedAttachmentBytes("/selected", f.open)).toEqual(
		new Uint8Array([104, 105]),
	);
	expect(f.isClosed()).toBe(true);
});

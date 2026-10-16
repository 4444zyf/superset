import { expect, test } from "bun:test";
import { validateClipboardFiles } from "./clipboard-files";

test("clipboard limits reject oversized batches before reading files", () => {
	const file = (size: number) => ({ size }) as File;
	expect(() => validateClipboardFiles([file(3), file(4)])).not.toThrow();
	for (const files of [
		[file(0)],
		[file(25 * 1024 * 1024 + 1)],
		Array.from({ length: 17 }, () => file(1)),
		[file(20 * 1024 * 1024), file(6 * 1024 * 1024)],
	])
		expect(() => validateClipboardFiles(files)).toThrow();
	expect(() => validateClipboardFiles([file(1), file(1)], 1)).toThrow();
});

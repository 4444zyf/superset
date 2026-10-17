import { msg } from "@lingui/core/macro";
import { i18n } from "@superset/i18n";

export const MAX_CLIPBOARD_FILES = 16;
export function validateClipboardFiles(
	files: readonly Pick<File, "size">[],
	availableSlots = MAX_CLIPBOARD_FILES,
): void {
	if (
		!files.length ||
		files.length > availableSlots ||
		files.length > MAX_CLIPBOARD_FILES ||
		files.some(
			(file) =>
				!Number.isSafeInteger(file.size) ||
				file.size < 1 ||
				file.size > 25 * 1024 * 1024,
		) ||
		files.reduce((total, file) => total + file.size, 0) > 25 * 1024 * 1024
	)
		throw new Error(
			i18n._(msg({ message: "Choose a nonempty attachment up to 25 MiB" })),
		);
}

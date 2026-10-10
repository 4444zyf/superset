import {
	closeSync,
	constants,
	fstatSync,
	openSync,
	readFileSync,
} from "node:fs";

export function readPrivateBackendFile(
	path: string,
	maximumBytes: number,
): string {
	const descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
	try {
		const stat = fstatSync(descriptor);
		if (
			!stat.isFile() ||
			stat.uid !== process.getuid?.() ||
			(stat.mode & 0o077) !== 0 ||
			stat.size > maximumBytes
		)
			throw new Error(
				"Backend health files must be private, bounded and owned by the service user",
			);
		return readFileSync(descriptor, "utf8");
	} finally {
		closeSync(descriptor);
	}
}

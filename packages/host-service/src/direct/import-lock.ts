import { lstatSync } from "node:fs";
import { join } from "node:path";

export function assertNoOfflineImport(homeDir: string): void {
	try {
		lstatSync(join(homeDir, "state", "legacy-import.lock"));
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
		throw error;
	}
	throw new Error(
		"An offline import must finish or recover before this backend can start",
	);
}

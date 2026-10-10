import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { runDirectEntry } from "./direct/entry";
import { startDirectBackend, stopOwnedBackend } from "./direct/runtime";

if (
	process.argv[1] &&
	import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
	void runDirectEntry(process.argv.slice(2), {
		start: (path) =>
			startDirectBackend(path, { onStopped: () => process.exit(0) }),
		stopOwned: stopOwnedBackend,
	})
		.then((backend) => {
			if (!backend) return;
			let stopping = false;
			const stop = async () => {
				if (stopping) return;
				stopping = true;
				await backend.stop();
				process.exit(0);
			};
			process.once("SIGTERM", () => void stop());
			process.once("SIGINT", () => void stop());
		})
		.catch((error) => {
			console.error("[direct-backend] failed", error);
			process.exit(1);
		});
}

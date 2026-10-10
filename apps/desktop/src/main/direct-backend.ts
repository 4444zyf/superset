import { importLegacyNamespace } from "@superset/host-service/direct-legacy-import";
import {
	startDirectBackend,
	stopOwnedBackend,
} from "@superset/host-service/direct-runtime";
import { runLocalBackendCommand } from "./lib/ssh-direct/local-backend-entry";

void runLocalBackendCommand(process.argv.slice(2), {
	start: (configPath) =>
		startDirectBackend(configPath, { onStopped: () => process.exit(0) }),
	stopOwned: stopOwnedBackend,
	importLocalData: async (targetConfigPath, sourceNamespaceDir) => {
		const result = await importLegacyNamespace({
			targetConfigPath,
			sourceNamespaceDir,
		});
		process.stdout.write(`${JSON.stringify(result)}\n`);
	},
})
	.then((backend) => {
		if (!backend) {
			process.exit(0);
			return;
		}
		let stopping = false;
		const stop = () => {
			if (stopping) return;
			stopping = true;
			void backend.stop().then(
				() => process.exit(0),
				() => process.exit(1),
			);
		};
		process.once("SIGTERM", stop);
		process.once("SIGINT", stop);
	})
	.catch((error) => {
		console.error("[local-backend]", error);
		process.exit(1);
	});

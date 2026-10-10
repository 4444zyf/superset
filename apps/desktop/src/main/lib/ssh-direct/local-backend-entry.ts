import { resolve } from "node:path";

interface BackendHandle {
	stop(): Promise<void>;
}

export async function runLocalBackendCommand(
	argv: string[],
	handlers: {
		start(configPath: string): Promise<BackendHandle>;
		stopOwned(configPath: string): Promise<void>;
		importLocalData?(
			configPath: string,
			sourceDirectory: string,
		): Promise<void>;
	},
): Promise<BackendHandle | null> {
	const index = argv.indexOf("--config");
	const configPath = argv[index + 1];
	if (index < 0 || !configPath || configPath.startsWith("--"))
		throw new Error("A local backend config path is required");
	const importIndex = argv.indexOf("--import-local-data");
	if (importIndex >= 0) {
		const source = argv[importIndex + 1];
		if (
			!source ||
			source.startsWith("--") ||
			argv.includes("--stop-owned") ||
			!handlers.importLocalData
		)
			throw new Error("A single offline import source directory is required");
		await handlers.importLocalData(resolve(configPath), resolve(source));
		return null;
	}
	if (argv.includes("--stop-owned")) {
		await handlers.stopOwned(resolve(configPath));
		return null;
	}
	return handlers.start(resolve(configPath));
}

import { resolve } from "node:path";

interface BackendHandle {
	stop(): Promise<void>;
}

export async function runLocalBackendCommand(
	argv: string[],
	handlers: {
		start(configPath: string): Promise<BackendHandle>;
		stopOwned(configPath: string): Promise<void>;
		queryLocalData?(configPath: string, request: unknown): Promise<void>;
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
	if (
		argv.filter((value) =>
			["--query-local-data", "--import-local-data", "--stop-owned"].includes(
				value,
			),
		).length > 1
	)
		throw new Error("Select one local backend action");
	const queryIndex = argv.indexOf("--query-local-data");
	if (queryIndex >= 0) {
		const raw = argv[queryIndex + 1];
		if (
			!raw ||
			raw.startsWith("--") ||
			Buffer.byteLength(raw) > 32 * 1024 ||
			!handlers.queryLocalData
		)
			throw new Error("A bounded local data query is required");
		await handlers.queryLocalData(resolve(configPath), JSON.parse(raw));
		return null;
	}
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

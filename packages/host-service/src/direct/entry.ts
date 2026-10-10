import { resolve } from "node:path";

export async function runDirectEntry<T>(
	args: string[],
	dependencies: {
		start: (configPath: string) => Promise<T>;
		stopOwned: (configPath: string) => Promise<void>;
	},
): Promise<T | null> {
	const index = args.indexOf("--config");
	const configPath = args[index + 1];
	if (index === -1 || !configPath || configPath.startsWith("--"))
		throw new Error(
			"Usage: host-service-direct.js [--stop-owned] --config <absolute config path>",
		);
	if (args.includes("--stop-owned")) {
		await dependencies.stopOwned(resolve(configPath));
		return null;
	}
	return dependencies.start(resolve(configPath));
}

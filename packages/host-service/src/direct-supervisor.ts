import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { setTimeout as wait } from "node:timers/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { finishPendingActivation } from "@superset/direct-install/control-runtime";
import { loadDirectConfig } from "./direct/config";
import { acquireDirectProcessLock } from "./direct/process-lock";
import {
	monitorDirectChild,
	superviseDirectBackend,
} from "./direct/supervisor";

export async function runDirectSupervisor(configPath: string): Promise<void> {
	const config = loadDirectConfig(configPath);
	const release = acquireDirectProcessLock(
		join(config.homeDir, "state", "supervisor.lock"),
	);
	const controller = new AbortController();
	const stop = () => controller.abort();
	process.on("SIGTERM", stop);
	process.on("SIGINT", stop);
	try {
		await superviseDirectBackend({
			signal: controller.signal,
			isDisabled: () => existsSync(join(config.homeDir, "state", "disabled")),
			beforeStart: async () => {
				if (config.installationMode !== "local")
					await finishPendingActivation(configPath, { phase: "before-start" });
			},
			spawnBackend: async () => {
				const current = loadDirectConfig(configPath);
				if (
					current.homeDir !== config.homeDir ||
					current.backendId !== config.backendId ||
					current.namespaceId !== config.namespaceId
				) {
					throw new Error(
						"Backend identity cannot change while its supervisor is running",
					);
				}
				const script =
					current.hostServicePath ??
					join(
						dirname(fileURLToPath(import.meta.url)),
						"host-service-direct.js",
					);
				const candidateNode = join(dirname(script), "node");
				const child = spawn(
					existsSync(candidateNode) ? candidateNode : process.execPath,
					[script, "--config", configPath],
					{ stdio: "inherit", cwd: config.homeDir },
				);
				const exited = new Promise<{
					exitCode: number | null;
					signal: NodeJS.Signals | null;
				}>((resolveExit, reject) => {
					child.once("error", reject);
					child.once("close", (exitCode, signal) =>
						resolveExit({ exitCode, signal }),
					);
				});
				const terminate = () => {
					if (child.exitCode === null && child.signalCode === null)
						child.kill("SIGTERM");
				};
				controller.signal.addEventListener("abort", terminate, { once: true });
				try {
					return config.installationMode === "local"
						? await exited
						: await monitorDirectChild(
								{ exited, terminate },
								({ stopCurrent }) =>
									finishPendingActivation(configPath, {
										phase: "after-start",
										stopCurrent,
									}),
							);
				} finally {
					controller.signal.removeEventListener("abort", terminate);
				}
			},
			waitForRetry: async (delayMs, signal) => {
				await wait(delayMs, undefined, { signal }).catch((error) => {
					if (!signal.aborted) throw error;
				});
			},
		});
	} finally {
		process.off("SIGTERM", stop);
		process.off("SIGINT", stop);
		release();
	}
}

if (
	process.argv[1] &&
	import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
	const index = process.argv.indexOf("--config");
	const configPath = process.argv[index + 1];
	if (index === -1 || !configPath) {
		console.error(
			"Usage: direct-supervisor.js --config <absolute config path>",
		);
		process.exitCode = 1;
	} else {
		void runDirectSupervisor(resolve(configPath)).catch((error) => {
			console.error("[direct-supervisor] failed", error);
			process.exitCode = 1;
		});
	}
}

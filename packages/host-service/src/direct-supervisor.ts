import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { setTimeout as wait } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import {
	finishPendingActivation,
	maintainBackendLogs,
} from "@superset/direct-install/control-runtime";
import { loadDirectConfig } from "./direct/config";
import { assertNoOfflineImport } from "./direct/import-lock";
import { acquireDirectProcessLock } from "./direct/process-lock";
import {
	monitorDirectChild,
	superviseDirectBackend,
} from "./direct/supervisor";

export async function runDirectSupervisor(configPath: string): Promise<void> {
	const config = loadDirectConfig(configPath);
	assertNoOfflineImport(config.homeDir);
	const release = acquireDirectProcessLock(
		join(config.homeDir, "state", "supervisor.lock"),
	);
	const controller = new AbortController();
	const stop = () => controller.abort();
	process.on("SIGTERM", stop);
	process.on("SIGINT", stop);
	try {
		assertNoOfflineImport(config.homeDir);
		await superviseDirectBackend({
			signal: controller.signal,
			isDisabled: () => existsSync(join(config.homeDir, "state", "disabled")),
			beforeStart: async () => {
				maintainBackendLogs(config.homeDir);
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
					return await monitorDirectChild(
						{ exited, terminate },
						async ({ stopCurrent }) => {
							maintainBackendLogs(config.homeDir);
							if (config.installationMode !== "local")
								await finishPendingActivation(configPath, {
									phase: "after-start",
									stopCurrent,
								});
						},
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

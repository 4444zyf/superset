import path from "node:path";
import { isolateDirectRuntimeEnvironment } from "../direct/agent-environment";
import { getTerminalBaseEnv, waitForTerminalBaseEnv } from "../terminal/env";

/**
 * Never imported from the login shell: these change how the host-service
 * runtime itself (and the node children it spawns) behaves. NODE_ENV is the
 * sharp one — a dotfile exporting NODE_ENV=development would flip serve.ts
 * into dev-mode shutdown, which kills the pty-daemon (and every PTY) on host
 * restart.
 */
const MERGE_DENYLIST = new Set([
	"NODE_ENV",
	"NODE_OPTIONS",
	"ELECTRON_RUN_AS_NODE",
	"SUPERSET_HOST_INSTALL_SOURCE",
	"SUPERSET_HOST_AUTO_UPDATE",
]);

/**
 * Enriches the host-service process env from the user's login shell, so git,
 * gh, and credential helpers resolve the same way they do in an interactive
 * terminal. The desktop wraps its spawned host-service in
 * getProcessEnvWithShellPath() (apps/desktop shell-env.ts); a CLI/systemd
 * launch inherits only the launcher's env, which on non-login shells lacks
 * homebrew/user PATH dirs and shell-exported tokens.
 *
 * Launcher-set values win: existing vars are never overwritten and existing
 * PATH entries keep their position — login-shell PATH entries are appended,
 * so a unit file that pins a specific binary first stays pinned.
 *
 * Reuses the terminal base-env snapshot (startTerminalBaseEnvResolution) so
 * the login shell is probed once per boot.
 */
export async function applyLoginShellEnvToProcess(
	targetEnv: NodeJS.ProcessEnv = process.env,
	options: {
		resolveShellEnvironment?: () => Promise<Record<string, string>>;
	} = {},
): Promise<void> {
	try {
		const shellEnv = options.resolveShellEnvironment
			? await options.resolveShellEnvironment()
			: await (async () => {
					await waitForTerminalBaseEnv();
					return getTerminalBaseEnv();
				})();

		for (const [key, value] of Object.entries(shellEnv)) {
			if (key === "PATH" || MERGE_DENYLIST.has(key)) continue;
			if (typeof targetEnv[key] === "string") continue;
			targetEnv[key] = value;
		}

		const shellPath = shellEnv.PATH;
		if (!shellPath) return;
		const current = (targetEnv.PATH ?? "")
			.split(path.delimiter)
			.filter(Boolean);
		const currentSet = new Set(current);
		const missing = shellPath
			.split(path.delimiter)
			.filter((entry) => entry && !currentSet.has(entry));
		if (missing.length === 0) return;
		targetEnv.PATH = [...current, ...missing].join(path.delimiter);
		console.log(
			`[host-service] merged ${missing.length} login-shell PATH entries into process env`,
		);
	} catch (error) {
		console.warn(
			"[host-service] login-shell env merge failed (continuing):",
			error,
		);
	} finally {
		const isolated = isolateDirectRuntimeEnvironment(targetEnv);
		if (isolated !== targetEnv) {
			for (const key of Object.keys(targetEnv))
				if (!(key in isolated)) delete targetEnv[key];
			Object.assign(targetEnv, isolated);
		}
	}
}

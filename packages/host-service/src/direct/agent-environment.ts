import { lstatSync, mkdirSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join, resolve } from "node:path";

let directHome: string | null = null;

export function configureDirectAgentEnvironment(homeDir: string | null): void {
	directHome = homeDir;
}

export function directAgentProfiles(): {
	claudeConfigDir: string;
	codexHome: string;
} | null {
	return directHome
		? {
				claudeConfigDir: join(directHome, "providers", "claude"),
				codexHome: join(directHome, "providers", "codex"),
			}
		: null;
}

function privateDirectory(path: string): void {
	try {
		mkdirSync(path, { mode: 0o700 });
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
	}
	const stat = lstatSync(path);
	if (
		!stat.isDirectory() ||
		stat.uid !== process.getuid?.() ||
		(stat.mode & 0o077) !== 0
	)
		throw new Error(
			"Direct agents require a private vendor profile owned by the service user",
		);
}

export function directAgentAccountEnv(): Record<string, string> | null {
	const profiles = directAgentProfiles();
	if (!profiles || !directHome) return null;
	privateDirectory(directHome);
	privateDirectory(join(directHome, "providers"));
	privateDirectory(profiles.claudeConfigDir);
	privateDirectory(profiles.codexHome);
	return {
		CLAUDE_CONFIG_DIR: profiles.claudeConfigDir,
		CODEX_HOME: profiles.codexHome,
	};
}

function canonical(path: string): string {
	try {
		return realpathSync(path);
	} catch {
		return resolve(path);
	}
}

export function directAgentPath(
	environment: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
	if (!directHome) return environment;
	const oldHome = environment.HOME ?? homedir();
	const blocked = [
		join(oldHome, ".superset", "bin"),
		join(homedir(), ".superset", "bin"),
		join(directHome, "bin"),
	].map(canonical);
	return {
		...environment,
		PATH: (environment.PATH ?? "")
			.split(delimiter)
			.filter((entry) => entry && !blocked.includes(canonical(entry)))
			.join(delimiter),
	};
}

export function isolateDirectAgentEnvironment(
	environment: Record<string, string>,
): Record<string, string> {
	const accounts = directAgentAccountEnv();
	if (!accounts) return environment;
	const env = { ...environment };
	for (const key of Object.keys(env)) {
		if (
			key === "AUTH_TOKEN" ||
			key === "SUPERSET_API_URL" ||
			/^SUPERSET_(?:DEFAULT_|AMBIENT_|AUTH|HOSTED|API_|AGENT_HOOK_|HOST_AGENT_HOOK_URL|ACCOUNT_ATTRIBUTION_TOKEN)/.test(
				key,
			) ||
			/^SUPERSET_.*(?:TOKEN|SECRET|API_KEY)$/.test(key)
		)
			delete env[key];
	}
	return { ...(directAgentPath(env) as Record<string, string>), ...accounts };
}

import { afterEach, expect, test } from "bun:test";
import {
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	statSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { agentCliCommand } from "../chat-v3/agentCli";
import type { HostDb } from "../db";
import {
	buildHostLaunchEnv,
	initTerminalBaseEnv,
	resetTerminalBaseEnvForTests,
} from "../terminal/env";
import { agentLaunchEnv } from "../terminal-agents/agent-config";
import { resolveDefaultAccountTerminalEnv } from "../trpc/router/usage/default-account";
import { configureDirectAgentEnvironment } from "./agent-environment";

const roots: string[] = [];
afterEach(() => {
	configureDirectAgentEnvironment(null);
	resetTerminalBaseEnvForTests();
	for (const root of roots.splice(0))
		rmSync(root, { recursive: true, force: true });
});

function fixture() {
	const root = mkdtempSync(join(tmpdir(), "direct-vendor-isolation-"));
	roots.push(root);
	const home = join(root, "legacy-user");
	const direct = join(root, "direct");
	for (const path of [
		home,
		direct,
		join(home, ".superset", "bin"),
		join(root, "vendor-bin"),
	])
		mkdirSync(path, { recursive: true, mode: 0o700 });
	const config = join(home, "settings.json");
	writeFileSync(
		config,
		JSON.stringify({
			hooks: { Stop: "superset cloud hook" },
			mcpServers: { superset: { url: "https://api.superset.sh/mcp" } },
		}),
	);
	const wrapper = join(home, ".superset", "bin", "codex");
	writeFileSync(wrapper, "#!/bin/sh\nexit 0\n", { mode: 0o700 });
	const executable = join(root, "vendor-bin", "codex");
	writeFileSync(executable, "#!/bin/sh\nexit 0\n", { mode: 0o700 });
	return { root, home, direct, config, executable };
}

test("direct launches use empty private vendor profiles without reading legacy account selections, MCP, hooks or credentials", () => {
	const f = fixture();
	const snapshot = {
		HOME: f.home,
		SHELL: "/bin/bash",
		PATH: [
			join(f.home, ".superset", "bin"),
			join(f.root, "vendor-bin"),
			"/usr/bin",
		].join(delimiter),
		CLAUDE_CONFIG_DIR: f.home,
		CODEX_HOME: f.home,
		SUPERSET_DEFAULT_CODEX_HOME: f.home,
		SUPERSET_AMBIENT_CODEX_HOME: f.home,
		SUPERSET_AUTH_TOKEN: "legacy-superset-token",
		AUTH_TOKEN: "legacy-host-token",
		SUPERSET_HOST_AGENT_HOOK_URL: "http://legacy/hook",
		SSH_AUTH_SOCK: "/tmp/remote-user-ssh-agent",
	};
	initTerminalBaseEnv(snapshot);
	configureDirectAgentEnvironment(f.direct);
	const db = {
		select: () => {
			throw new Error("Legacy account database was read");
		},
	} as unknown as HostDb;
	const env = {
		...buildHostLaunchEnv({
			cwd: f.direct,
			workspaceId: "workspace",
			workspacePath: f.direct,
			rootPath: f.direct,
		}),
		...resolveDefaultAccountTerminalEnv(db),
	};
	expect(env.CLAUDE_CONFIG_DIR).toBe(join(f.direct, "providers", "claude"));
	expect(env.CODEX_HOME).toBe(join(f.direct, "providers", "codex"));
	expect(env.HOME).toBe(f.home);
	expect(env.SSH_AUTH_SOCK).toBe(snapshot.SSH_AUTH_SOCK);
	expect(env.SUPERSET_AUTH_TOKEN).toBeUndefined();
	expect(env.AUTH_TOKEN).toBeUndefined();
	expect(env.SUPERSET_HOST_AGENT_HOOK_URL).toBeUndefined();
	expect(env.SUPERSET_DEFAULT_CODEX_HOME).toBeUndefined();
	expect(env.SUPERSET_AMBIENT_CODEX_HOME).toBeUndefined();
	expect(agentCliCommand("codex", env)).toBe(f.executable);
	for (const path of [env.CLAUDE_CONFIG_DIR!, env.CODEX_HOME!]) {
		expect(readdirSync(path)).toEqual([]);
		expect(statSync(path).mode & 0o777).toBe(0o700);
	}
	expect(JSON.parse(readFileSync(f.config, "utf8"))).toHaveProperty(
		"mcpServers.superset",
	);
	expect(
		agentLaunchEnv(db, {
			presetId: "claude",
			env: { CLAUDE_CONFIG_DIR: f.home },
		}).CLAUDE_CONFIG_DIR,
	).toBe(f.home);
});

test("an unexpected profile symlink fails closed instead of loading the old user's vendor configuration", () => {
	const f = fixture();
	mkdirSync(join(f.direct, "providers"), { mode: 0o700 });
	symlinkSync(f.home, join(f.direct, "providers", "claude"));
	configureDirectAgentEnvironment(f.direct);
	expect(() => resolveDefaultAccountTerminalEnv({} as HostDb)).toThrow(
		"private vendor profile",
	);
});

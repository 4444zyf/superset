import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	buildHostLaunchEnv,
	initTerminalBaseEnv,
	resetTerminalBaseEnvForTests,
} from "../terminal/env";
import { configureDirectAgentEnvironment } from "./agent-environment";
import { registerDirectAgentHookPort } from "./agent-hook-url";

function fixture(direct: boolean) {
	const directory = mkdtempSync(join(tmpdir(), "owned-agent-hook-env-"));
	configureDirectAgentEnvironment(direct ? directory : null);
	initTerminalBaseEnv({
		PATH: "/usr/bin:/bin",
		SHELL: "/bin/sh",
		HOME: directory,
		AUTH_TOKEN: "owned-stale-token",
		SUPERSET_HOST_AGENT_HOOK_URL:
			"http://127.0.0.1:1234/trpc/notifications.hook",
	});
	return {
		build: () =>
			buildHostLaunchEnv({
				cwd: directory,
				workspaceId: "workspace",
				workspacePath: directory,
				rootPath: directory,
				terminalId: "terminal",
				hostAgentHookUrl: "http://127.0.0.1:8080/trpc/notifications.hook",
			}),
		cleanup: () => {
			configureDirectAgentEnvironment(null);
			resetTerminalBaseEnvForTests();
			rmSync(directory, { recursive: true, force: true });
		},
	};
}

test("a direct launch restores only its listener's hook after stripping inherited runtime identity", () => {
	const f = fixture(true),
		release = registerDirectAgentHookPort(43123);
	try {
		const env = f.build();
		expect(env.SUPERSET_HOST_AGENT_HOOK_URL).toBe(
			"http://127.0.0.1:43123/trpc/notifications.hook",
		);
		expect(env.AUTH_TOKEN).toBeUndefined();
		expect(env.SUPERSET_TERMINAL_ID).toBe("terminal");
	} finally {
		release();
		f.cleanup();
	}
});

test("an unready direct launch drops stale hook addresses", () => {
	const f = fixture(true);
	try {
		expect(f.build().SUPERSET_HOST_AGENT_HOOK_URL).toBeUndefined();
	} finally {
		f.cleanup();
	}
});

test("a legacy launch keeps its original explicit hook even while a direct listener is registered", () => {
	const f = fixture(false),
		release = registerDirectAgentHookPort(43123);
	try {
		expect(f.build().SUPERSET_HOST_AGENT_HOOK_URL).toBe(
			"http://127.0.0.1:8080/trpc/notifications.hook",
		);
	} finally {
		release();
		f.cleanup();
	}
});

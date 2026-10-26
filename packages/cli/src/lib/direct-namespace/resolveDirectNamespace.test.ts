import { afterEach, expect, test } from "bun:test";
import {
	chmodSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	rmSync,
	symlinkSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgv } from "@superset/cli-framework";
import { directBackendSocketPath } from "@superset/shared/direct-backend-socket";
import readTerminal from "../../commands/terminals/read/command";
import listBrowser from "../../commands/browser/list/command";
import browserConsole from "../../commands/browser/console/command";
import getWorkspace from "../../commands/workspaces/get/command";
import { createUnavailableApiClient } from "../api-client";
import { readFromDirectNamespace } from "./readFromDirectNamespace";
import { resolveDirectNamespace } from "./resolveDirectNamespace";

const roots: string[] = [],
	servers: Server[] = [];
afterEach(async () => {
	for (const server of servers.splice(0))
		await new Promise<void>((resolve) => server.close(() => resolve()));
	for (const root of roots.splice(0))
		rmSync(root, { recursive: true, force: true });
});
async function fixture() {
	const homeDir = mkdtempSync(join(tmpdir(), "remix-cli-namespace-"));
	roots.push(homeDir);
	for (const name of ["state", "credentials"])
		mkdirSync(join(homeDir, name), { mode: 0o700 });
	const config = {
		backendId: crypto.randomUUID(),
		namespaceId: crypto.randomUUID(),
		homeDir,
		secretFile: join(homeDir, "credentials/host-secret"),
		migrationsFolder: join(homeDir, "migrations"),
		allowedOrigins: [],
		installationMode: "local",
	};
	const endpoint = {
		backendId: config.backendId,
		namespaceId: config.namespaceId,
		instanceId: "cli-instance",
		serviceUid: process.getuid!(),
		runtimeMode: "direct",
		protocolVersion: 1,
		port: 54321,
		socketPath: directBackendSocketPath({ ...config, uid: process.getuid!() }),
	};
	const socketDir = join(endpoint.socketPath, "..");
	mkdirSync(socketDir, { mode: 0o700, recursive: true });
	roots.push(socketDir);
	const write = (path: string, value: string) =>
		writeFileSync(join(homeDir, path), value, { mode: 0o600 });
	write("service-config.json", JSON.stringify(config));
	write(
		"identity.json",
		JSON.stringify({
			backendId: config.backendId,
			namespaceId: config.namespaceId,
		}),
	);
	write("credentials/host-secret", "a".repeat(64));
	write("state/endpoint.json", JSON.stringify(endpoint));
	const requests: Array<{ path: string; authenticated: boolean }> = [];
	const workspace = {
		id: crypto.randomUUID(),
		name: "Namespace 工作区",
		branch: "feature/read-details",
		type: "worktree",
		projectId: crypto.randomUUID(),
		projectName: "项目 中文",
		hostId: config.backendId,
		taskId: null,
		worktreePath: join(homeDir, "Superset Remix/worktrees/项目 中文/feature"),
		worktreeExists: false,
		createdAt: "2026-10-20T00:00:00.000Z",
	};
	let workspaceRows: Array<Record<string, unknown>> = [workspace];
	let description = {
		...endpoint,
		cloudAccountRequired: false,
		capabilities: {
			projects: true,
			sessions: true,
			terminals: true,
			workstationAgentCatalogReadV1: true,
			workstationTerminalScriptsV1: true,
		},
	};
	const server = createServer((request, response) => {
		requests.push({
			path: request.url ?? "",
			authenticated:
				request.headers.authorization === `Bearer ${"a".repeat(64)}`,
		});
		response.setHeader("Content-Type", "application/json");
		if (!requests.at(-1)!.authenticated) {
			response.writeHead(401);
			response.end("{}");
			return;
		}
		if (request.url === "/direct/describe") {
			response.end(JSON.stringify(description));
			return;
		}
		if (request.url?.startsWith("/trpc/direct.browserReadV1?")) {
			const url = new URL(request.url, "http://fixture.invalid");
			const operation = JSON.parse(url.searchParams.get("input")!)["0"].json;
			const result =
				operation.type === "list"
					? {
							panes: [
								{
									paneId: "pane",
									workspaceId: operation.workspaceId,
									url: "http://localhost:3000/中文",
									title: "中文 page",
									isLoading: false,
								},
							],
						}
					: {
							entries: [
								{ level: "info", message: "first", timestamp: 1 },
								{ level: "warn", message: "中文 output", timestamp: 2 },
							],
						};
			response.end(JSON.stringify([{ result: { data: { json: result } } }]));
			return;
		}
		if (request.url?.startsWith("/trpc/workspace.list?")) {
			response.end(
				JSON.stringify([{ result: { data: { json: workspaceRows } } }]),
			);
			return;
		}
		if (request.url?.startsWith("/trpc/terminal.snapshot?")) {
			response.end(
				JSON.stringify([
					{
						result: {
							data: {
								json: {
									terminalId: "terminal-a",
									text: "Agent 输出\nlast line",
									rows: 2,
									cols: 80,
								},
							},
						},
					},
				]),
			);
			return;
		}
		response.end(
			JSON.stringify([
				{
					result: {
						data: { json: [{ id: "project", name: "Only this namespace" }] },
					},
				},
			]),
		);
	});
	servers.push(server);
	await new Promise<void>((resolve) =>
		server.listen(endpoint.socketPath, resolve),
	);
	chmodSync(endpoint.socketPath, 0o600);
	return {
		homeDir,
		config,
		endpoint,
		requests,
		workspace,
		setWorkspaceRows: (rows: Array<Record<string, unknown>>) => {
			workspaceRows = rows;
		},
		write,
		setDescription: (value: Partial<typeof description>) => {
			description = { ...description, ...value };
		},
	};
}

type WorkspaceDetailResult = { data: Record<string, unknown>; message: string };

function readWorkspaceDetail(
	f: Awaited<ReturnType<typeof fixture>>,
	id: string | undefined = f.workspace.id,
	field?: string,
) {
	return getWorkspace.run({
		ctx: {
			config: {},
			bearer: "",
			authSource: "direct",
			api: createUnavailableApiClient(),
		},
		args: { id } as never,
		options: { namespace: f.homeDir, field } as never,
		signal: new AbortController().signal,
	}) as Promise<WorkspaceDetailResult>;
}

test("the original CLI parser accepts namespace and the existing field alias for workspace details", () => {
	const configs = Object.fromEntries(
		Object.entries(getWorkspace.options ?? {}).map(([name, builder]) => [
			name,
			{ ...builder._.config, name },
		]),
	);
	expect(
		parseArgv(
			[
				"bun",
				"superset",
				"workspaces",
				"get",
				"workspace-a",
				"--namespace",
				"/tmp/Namespace 中文",
				"-f",
				"worktreePath",
			],
			configs,
		).options,
	).toEqual({ namespace: "/tmp/Namespace 中文", field: "worktreePath" });
});

test("workspace details reuse original host fields from the selected namespace without a Superset account", async () => {
	const f = await fixture();
	const result = await readWorkspaceDetail(f);
	expect(result.data).toEqual({ ...f.workspace, hostName: f.workspace.hostId });
	expect(result.message).toContain("Namespace 工作区");
	expect(result.message).toContain(f.workspace.worktreePath);
	expect(f.requests.every((request) => request.authenticated)).toBe(true);
	expect(f.requests.map((request) => request.path.split("?")[0])).toEqual([
		"/direct/describe",
		"/trpc/workspace.list",
	]);
});

test("namespace workspace details retain raw field output, nulls, project fallback and inherited-field rejection", async () => {
	const f = await fixture();
	f.setWorkspaceRows([{ ...f.workspace, projectName: null }]);
	expect(
		(await readWorkspaceDetail(f, f.workspace.id, "projectName")).message,
	).toBe(f.workspace.projectId);
	expect((await readWorkspaceDetail(f, f.workspace.id, "taskId")).message).toBe(
		"",
	);
	expect(
		(await readWorkspaceDetail(f, f.workspace.id, "worktreeExists")).message,
	).toBe("false");
	await expect(
		readWorkspaceDetail(f, f.workspace.id, "toString"),
	).rejects.toThrow("Unknown field: toString");
});

test("workspace details cannot fall through to another namespace when a requested id is missing", async () => {
	const a = await fixture(),
		b = await fixture();
	expect((await readWorkspaceDetail(a)).data.id).toBe(a.workspace.id);
	expect((await readWorkspaceDetail(b)).data.id).toBe(b.workspace.id);
	await expect(readWorkspaceDetail(a, b.workspace.id)).rejects.toThrow(
		"not found",
	);
	expect(
		a.requests.every(
			(request) =>
				request.path === "/direct/describe" ||
				request.path.startsWith("/trpc/workspace.list?"),
		),
	).toBe(true);
});

test("an explicit namespace retains the original workspace-id environment fallback", async () => {
	const f = await fixture();
	const previous = process.env.SUPERSET_WORKSPACE_ID;
	process.env.SUPERSET_WORKSPACE_ID = f.workspace.id;
	try {
		const result = (await getWorkspace.run({
			ctx: {
				config: {},
				bearer: "",
				authSource: "direct",
				api: createUnavailableApiClient(),
			},
			args: {} as never,
			options: { namespace: f.homeDir } as never,
			signal: new AbortController().signal,
		})) as WorkspaceDetailResult;
		expect(result.data.id).toBe(f.workspace.id);
	} finally {
		if (previous === undefined) delete process.env.SUPERSET_WORKSPACE_ID;
		else process.env.SUPERSET_WORKSPACE_ID = previous;
	}
});

test("an explicit namespace authenticates and reads through its owned Unix socket", async () => {
	const f = await fixture(),
		target = await resolveDirectNamespace(f.homeDir);
	expect(target.description.namespaceId).toBe(f.config.namespaceId);
	expect(
		(await target.client.project.list.query()).map(({ id, name }) => ({
			id,
			name,
		})),
	).toEqual([{ id: "project", name: "Only this namespace" }]);
	expect(f.requests.every((r) => r.authenticated)).toBe(true);
	expect(f.requests[1]?.path.startsWith("/trpc/project.list")).toBe(true);
});

test("the original terminal read command reads the selected namespace without organization credentials", async () => {
	const f = await fixture();
	const result = await readTerminal.run({
		ctx: { config: {}, bearer: "", authSource: "direct" } as never,
		args: {} as never,
		options: {
			namespace: f.homeDir,
			workspace: "workspace-a",
			terminal: "terminal-a",
			maxLines: 2,
		} as never,
		signal: new AbortController().signal,
	});
	expect(result).toEqual({
		data: {
			terminalId: "terminal-a",
			text: "Agent 输出\nlast line",
			rows: 2,
			cols: 80,
		},
		message: "Agent 输出\nlast line",
	});
	const url = new URL(f.requests[1]!.path, "http://fixture.invalid");
	expect(url.pathname).toBe("/trpc/terminal.snapshot");
	expect(JSON.parse(url.searchParams.get("input")!)).toEqual({
		"0": {
			json: {
				terminalId: "terminal-a",
				workspaceId: "workspace-a",
				maxLines: 2,
			},
		},
	});
	expect(f.requests.every((request) => request.authenticated)).toBe(true);
});

test("terminal read rejects a missing terminal capability before making a snapshot request", async () => {
	const f = await fixture();
	f.setDescription({ capabilities: { terminals: false } as never });
	const target = await resolveDirectNamespace(f.homeDir);
	await expect(
		target.client.terminal.snapshot.query({
			terminalId: "terminal-a",
			workspaceId: "workspace-a",
		}),
	).rejects.toThrow("capability");
	expect(f.requests.map((request) => request.path)).toEqual([
		"/direct/describe",
	]);
});

test("terminal read keeps the legacy organization requirement and refuses conflicting explicit targets", async () => {
	const f = await fixture();
	const invoke = (options: object) =>
		readTerminal.run({
			ctx: { config: {}, bearer: "", authSource: "direct" } as never,
			args: {} as never,
			options: {
				workspace: "workspace-a",
				terminal: "terminal-a",
				...options,
			} as never,
			signal: new AbortController().signal,
		});
	await expect(invoke({})).rejects.toThrow("No active organization");
	await expect(invoke({ namespace: f.homeDir, host: "other" })).rejects.toThrow(
		"either --namespace or --host",
	);
	expect(f.requests).toEqual([]);
});

test("read-only namespace access refuses both mutations and the legacy Agent query that can seed defaults", async () => {
	const f = await fixture(),
		target = await resolveDirectNamespace(f.homeDir);
	await expect(
		target.client.settings.agentConfigs.list.query(),
	).rejects.toThrow("read-only");
	await expect(
		target.client.project.update.mutate({} as never),
	).rejects.toThrow("read-only");
	expect(f.requests.map((r) => r.path)).toEqual(["/direct/describe"]);
});

test("a stopped or absent namespace is never created or started", async () => {
	const f = await fixture();
	f.write("state/disabled", "stopped");
	await expect(resolveDirectNamespace(f.homeDir)).rejects.toThrow("stopped");
	expect(f.requests).toEqual([]);
	const missing = join(f.homeDir, "missing");
	await expect(resolveDirectNamespace(missing)).rejects.toThrow();
	expect(existsSync(missing)).toBe(false);
});

test("foreign endpoint identity and a mismatched authenticated description are refused", async () => {
	const f = await fixture();
	f.write(
		"state/endpoint.json",
		JSON.stringify({ ...f.endpoint, namespaceId: crypto.randomUUID() }),
	);
	await expect(resolveDirectNamespace(f.homeDir)).rejects.toThrow("identity");
	expect(f.requests).toEqual([]);
	f.write("state/endpoint.json", JSON.stringify(f.endpoint));
	f.setDescription({ instanceId: "replaced-instance" });
	await expect(resolveDirectNamespace(f.homeDir)).rejects.toThrow("identity");
});

test("a query cannot silently cross to a replacement endpoint after verification", async () => {
	const f = await fixture(),
		target = await resolveDirectNamespace(f.homeDir);
	f.write(
		"state/endpoint.json",
		JSON.stringify({ ...f.endpoint, instanceId: "new-instance" }),
	);
	await expect(target.client.project.list.query()).rejects.toThrow("changed");
	expect(f.requests).toHaveLength(1);
});

test("a missing read capability is rejected before sending a procedure to an older backend", async () => {
	const f = await fixture();
	f.setDescription({ capabilities: {} as never });
	const target = await resolveDirectNamespace(f.homeDir);
	await expect(target.client.project.list.query()).rejects.toThrow(
		"capability",
	);
	expect(f.requests).toHaveLength(1);
});

test("namespace secrets must remain private regular files", async () => {
	const f = await fixture();
	chmodSync(f.config.secretFile, 0o644);
	await expect(resolveDirectNamespace(f.homeDir)).rejects.toThrow();
	expect(f.requests).toEqual([]);
	chmodSync(f.config.secretFile, 0o600);
	const alternate = join(f.homeDir, "alternate");
	writeFileSync(alternate, "a".repeat(64), { mode: 0o600 });
	unlinkSync(f.config.secretFile);
	symlinkSync(alternate, f.config.secretFile);
	await expect(resolveDirectNamespace(f.homeDir)).rejects.toThrow();
	expect(f.requests).toEqual([]);
});

test("an absent namespace keeps the old command branch and conflicting targets never read credentials", async () => {
	const f = await fixture();
	let entered = false;
	expect(
		await readFromDirectNamespace({}, async () => {
			entered = true;
			return [];
		}),
	).toBeNull();
	await expect(
		readFromDirectNamespace(
			{ namespace: f.homeDir, host: "other" },
			async () => {
				entered = true;
				return [];
			},
		),
	).rejects.toThrow("either --namespace or --host");
	expect(entered).toBe(false);
	expect(f.requests).toEqual([]);
});

function runBrowser(
	command: typeof listBrowser | typeof browserConsole,
	options: Record<string, unknown>,
) {
	return command.run({
		ctx: {
			config: {},
			bearer: "",
			authSource: "direct",
			api: createUnavailableApiClient(),
		},
		args: {} as never,
		options: { workspace: "owned", pane: "pane", ...options } as never,
		signal: new AbortController().signal,
	});
}

test("browser list accepts the namespace flag and reads scoped metadata without an organization", async () => {
	const f = await fixture();
	f.setDescription({
		capabilities: { workstationBrowserReadBridgeV1: true } as never,
	});
	const configs = Object.fromEntries(
		Object.entries(listBrowser.options ?? {}).map(([name, builder]) => [
			name,
			{ ...builder._.config, name },
		]),
	);
	expect(
		parseArgv(["bun", "superset", "--namespace", f.homeDir, "--workspace", "owned"], configs)
			.options,
	).toMatchObject({ namespace: f.homeDir, workspace: "owned" });
	const result = await runBrowser(listBrowser, { namespace: f.homeDir });
	expect(result).toEqual({
		data: [
			{
				paneId: "pane",
				workspaceId: "owned",
				url: "http://localhost:3000/中文",
				title: "中文 page",
				isLoading: false,
			},
		],
		message: "pane\thttp://localhost:3000/中文\t中文 page",
	});
	const url = new URL(f.requests[1]!.path, "http://fixture.invalid");
	expect(JSON.parse(url.searchParams.get("input")!)).toEqual({
		"0": { json: { type: "list", workspaceId: "owned" } },
	});
	expect(f.requests.every((request) => request.authenticated)).toBe(true);
});

test("browser console retains the original bottom limit including zero through namespace reads", async () => {
	const f = await fixture();
	f.setDescription({
		capabilities: { workstationBrowserReadBridgeV1: true } as never,
	});
	expect(
		await runBrowser(browserConsole, { namespace: f.homeDir, maxLines: 1 }),
	).toEqual({
		data: [{ level: "warn", message: "中文 output", timestamp: 2 }],
		message: "[warn] 中文 output",
	});
	expect(
		await runBrowser(browserConsole, { namespace: f.homeDir, maxLines: 0 }),
	).toEqual({ data: [], message: "No console output captured." });
	const url = new URL(f.requests[1]!.path, "http://fixture.invalid");
	expect(JSON.parse(url.searchParams.get("input")!)).toEqual({
		"0": { json: { type: "console", workspaceId: "owned", paneId: "pane" } },
	});
});

test("browser read support without a ready desktop peer is rejected before a namespace RPC", async () => {
	const f = await fixture();
	f.setDescription({
		capabilities: { workstationBrowserReadBridgeConnectV1: true } as never,
	});
	await expect(
		runBrowser(listBrowser, { namespace: f.homeDir }),
	).rejects.toThrow("capability");
	await expect(
		runBrowser(browserConsole, { namespace: f.homeDir }),
	).rejects.toThrow("capability");
	expect(f.requests.map((request) => request.path)).toEqual([
		"/direct/describe",
		"/direct/describe",
	]);
});

test("browser commands preserve default account requirements and reject ambiguous namespace targets", async () => {
	const f = await fixture();
	await expect(runBrowser(listBrowser, {})).rejects.toThrow(
		"No active organization",
	);
	await expect(runBrowser(browserConsole, {})).rejects.toThrow(
		"No active organization",
	);
	await expect(
		runBrowser(listBrowser, { namespace: f.homeDir, host: "other" }),
	).rejects.toThrow("either --namespace or --host");
	await expect(
		runBrowser(browserConsole, { namespace: f.homeDir, maxLines: -1 }),
	).rejects.toThrow("--max-lines must be >= 0");
	expect(f.requests).toEqual([]);
});

import { afterEach, expect, test } from "bun:test";
import {
	chmodSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	symlinkSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { camelToKebab, parseArgv } from "@superset/cli-framework";
import { directBackendSocketPath } from "@superset/shared/direct-backend-socket";
import SuperJSON from "superjson";
import browserConsole from "../../commands/browser/console/command";
import evalBrowser from "../../commands/browser/eval/command";
import listBrowser from "../../commands/browser/list/command";
import navigateBrowser from "../../commands/browser/navigate/command";
import openBrowser from "../../commands/browser/open/command";
import operationStatus from "../../commands/browser/operation-status/command";
import screenshotBrowser from "../../commands/browser/screenshot/command";
import readTerminal from "../../commands/terminals/read/command";
import getWorkspace from "../../commands/workspaces/get/command";
import { createUnavailableApiClient } from "../api-client";
import { readFromDirectNamespace } from "./readFromDirectNamespace";
import {
	resolveBrowserEvaluationNamespace,
	resolveBrowserNavigationNamespace,
	resolveBrowserOpenNamespace,
	resolveDirectNamespace,
} from "./resolveDirectNamespace";

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
	const requests: Array<{
		path: string;
		authenticated: boolean;
		method?: string;
		body?: unknown;
	}> = [];
	let navigationResponse: { status: number; value: unknown } | null = null;
	let receipt: unknown = null;
	let openResponse: { status: number; value: unknown } | null = null;
	let openResultOverride = false,
		openResult: unknown;
	let evaluationResult: unknown = 0;
	let evaluationResponse: { status: number; value: unknown } | null = null;
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
	const server = createServer(async (request, response) => {
		requests.push({
			path: request.url ?? "",
			method: request.method,
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
		if (request.url?.startsWith("/trpc/direct.browserOpenV1?")) {
			let body = "";
			for await (const chunk of request) body += chunk;
			const input = JSON.parse(body)["0"].json;
			requests.at(-1)!.body = input;
			receipt = {
				operationId: input.operationId,
				procedure: "browser.openV1",
				status: "completed",
				result: openResultOverride
					? openResult
					: { paneId: "owned-open", url: input.url, title: "Owned 标题" },
			};
			if (openResponse) {
				response.statusCode = openResponse.status;
				response.end(JSON.stringify(openResponse.value));
			} else
				response.end(
					JSON.stringify([{ result: { data: SuperJSON.serialize(receipt) } }]),
				);
			return;
		}
		if (request.url?.startsWith("/trpc/direct.browserEvaluateV1?")) {
			let body = "";
			for await (const chunk of request) body += chunk;
			const input = JSON.parse(body)["0"].json;
			requests.at(-1)!.body = input;
			receipt = {
				operationId: input.operationId,
				procedure: "browser.evaluateV1",
				status: "completed",
				result: { result: evaluationResult },
			};
			if (evaluationResponse) {
				response.statusCode = evaluationResponse.status;
				response.end(JSON.stringify(evaluationResponse.value));
			} else
				response.end(
					JSON.stringify([{ result: { data: SuperJSON.serialize(receipt) } }]),
				);
			return;
		}
		if (request.url?.startsWith("/trpc/direct.browserNavigateV1?")) {
			let body = "";
			for await (const chunk of request) body += chunk;
			const input = JSON.parse(body)["0"].json;
			requests.at(-1)!.body = input;
			receipt = {
				operationId: input.operationId,
				procedure: "browser.navigateV1",
				status: "completed",
				result: { ok: true },
			};
			if (navigationResponse) {
				response.statusCode = navigationResponse.status;
				response.end(JSON.stringify(navigationResponse.value));
			} else
				response.end(JSON.stringify([{ result: { data: { json: receipt } } }]));
			return;
		}
		if (request.url?.startsWith("/trpc/direct.operationStatus?")) {
			response.end(
				JSON.stringify([{ result: { data: SuperJSON.serialize(receipt) } }]),
			);
			return;
		}
		if (request.url?.startsWith("/trpc/direct.browserCaptureV1?")) {
			response.end(
				JSON.stringify([
					{
						result: {
							data: {
								json: {
									base64:
										"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5f8AAAAASUVORK5CYII=",
								},
							},
						},
					},
				]),
			);
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
		setOpenResult(value: unknown) {
			openResultOverride = true;
			openResult = value;
		},
		setOpenResponse(value: typeof openResponse) {
			openResponse = value;
		},
		setEvaluationResult(value: unknown) {
			evaluationResult = value;
		},
		setEvaluationResponse(value: typeof evaluationResponse) {
			evaluationResponse = value;
		},
		setNavigationResponse(value: typeof navigationResponse) {
			navigationResponse = value;
		},
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
	command:
		| typeof listBrowser
		| typeof browserConsole
		| typeof screenshotBrowser
		| typeof navigateBrowser
		| typeof operationStatus
		| typeof evalBrowser
		| typeof openBrowser,
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
		parseArgv(
			["bun", "superset", "--namespace", f.homeDir, "--workspace", "owned"],
			configs,
		).options,
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

test("namespace screenshots retain the original PNG file output without account credentials", async () => {
	const f = await fixture(),
		output = join(f.homeDir, "owned-capture.png");
	f.setDescription({
		capabilities: { workstationBrowserCaptureV1: true } as never,
	});
	expect(
		await runBrowser(screenshotBrowser, { namespace: f.homeDir, out: output }),
	).toEqual({ data: { path: output }, message: `Wrote ${output}` });
	expect(readFileSync(output).subarray(0, 8)).toEqual(
		Buffer.from("89504e470d0a1a0a", "hex"),
	);
	const url = new URL(f.requests[1]!.path, "http://fixture.invalid");
	expect(url.pathname).toBe("/trpc/direct.browserCaptureV1");
	expect(JSON.parse(url.searchParams.get("input")!)).toEqual({
		"0": { json: { workspaceId: "owned", paneId: "pane" } },
	});
	expect(f.requests.every((request) => request.authenticated)).toBe(true);
});

test("namespace screenshots without an output path preserve the base64 envelope", async () => {
	const f = await fixture();
	f.setDescription({
		capabilities: { workstationBrowserCaptureV1: true } as never,
	});
	const result = (await runBrowser(screenshotBrowser, {
		namespace: f.homeDir,
	})) as { data: { base64: string }; message: string };
	expect(result.message).toBe(result.data.base64);
	expect(Buffer.from(result.data.base64, "base64").subarray(0, 8)).toEqual(
		Buffer.from("89504e470d0a1a0a", "hex"),
	);
});

test("read metadata capability alone cannot request a screenshot or write a PNG", async () => {
	const f = await fixture(),
		output = join(f.homeDir, "denied.png");
	f.setDescription({
		capabilities: { workstationBrowserReadBridgeV1: true } as never,
	});
	await expect(
		runBrowser(screenshotBrowser, { namespace: f.homeDir, out: output }),
	).rejects.toThrow("capability");
	expect(f.requests.map((request) => request.path)).toEqual([
		"/direct/describe",
	]);
	expect(existsSync(output)).toBe(false);
});

const navigationInput = () => ({
	operationId: crypto.randomUUID(),
	workspaceId: "owned",
	paneId: "pane",
	url: "http://localhost:3000/中文#section",
});

test("namespace navigate accepts the stable operation flag and preserves original success output", async () => {
	const f = await fixture();
	f.setDescription({
		capabilities: {
			durableOperations: true,
			workstationBrowserNavigationV1: true,
		} as never,
	});
	const input = navigationInput();
	const configs = Object.fromEntries(
		Object.entries(navigateBrowser.options!).map(([name, builder]) => [
			name,
			{ ...builder._.config, name: camelToKebab(name) },
		]),
	);
	expect(
		parseArgv(
			[
				"bun",
				"superset",
				"--namespace",
				f.homeDir,
				"--operation-id",
				input.operationId,
				"--workspace",
				"owned",
				"--pane",
				"pane",
				"--url",
				input.url,
			],
			configs,
		).options,
	).toMatchObject({ operationId: input.operationId, namespace: f.homeDir });
	expect(
		await runBrowser(navigateBrowser, {
			namespace: f.homeDir,
			operationId: input.operationId,
			url: input.url,
		}),
	).toEqual({ data: { ok: true }, message: "Navigated pane" });
	expect(f.requests).toHaveLength(2);
	expect(f.requests[1]).toMatchObject({
		method: "POST",
		authenticated: true,
		body: input,
	});
	expect(new URL(f.requests[1]!.path, "http://fixture.invalid").pathname).toBe(
		"/trpc/direct.browserNavigateV1",
	);
});

test("only the navigation resolver can send one versioned navigation mutation", async () => {
	const f = await fixture();
	f.setDescription({
		capabilities: {
			durableOperations: true,
			workstationBrowserNavigationV1: true,
		} as never,
	});
	const read = await resolveDirectNamespace(f.homeDir);
	await expect(
		read.client.direct.browserNavigateV1.mutate(navigationInput()),
	).rejects.toThrow("read-only");
	const write = await resolveBrowserNavigationNamespace(f.homeDir);
	await expect(write.client.project.update.mutate({} as never)).rejects.toThrow(
		"read-only",
	);
	await expect(write.client.direct.execute.mutate({} as never)).rejects.toThrow(
		"read-only",
	);
	await expect(
		Promise.all([
			write.client.direct.browserNavigateV1.mutate(navigationInput()),
			write.client.direct.browserNavigateV1.mutate(navigationInput()),
		]),
	).rejects.toThrow("read-only");
	expect(f.requests.every((r) => r.path === "/direct/describe")).toBe(true);
});

test("navigation requires both durable operations and the ready navigation capability", async () => {
	const f = await fixture();
	for (const capabilities of [
		{},
		{ durableOperations: true },
		{ workstationBrowserNavigationV1: true },
		{ workstationBrowserReadBridgeV1: true, durableOperations: true },
	]) {
		f.setDescription({ capabilities: capabilities as never });
		await expect(
			runBrowser(navigateBrowser, {
				namespace: f.homeDir,
				operationId: crypto.randomUUID(),
				url: "http://localhost:3000",
			}),
		).rejects.toThrow("capability");
	}
	expect(f.requests).toHaveLength(4);
	expect(f.requests.every((r) => r.path === "/direct/describe")).toBe(true);
});

test("navigation validates explicit target and operation flags before reading credentials", async () => {
	const f = await fixture();
	await expect(
		runBrowser(navigateBrowser, {
			namespace: f.homeDir,
			url: "https://example.com",
		}),
	).rejects.toThrow("requires --operation-id");
	await expect(
		runBrowser(navigateBrowser, {
			operationId: crypto.randomUUID(),
			url: "https://example.com",
		}),
	).rejects.toThrow("requires --namespace");
	await expect(
		runBrowser(navigateBrowser, {
			namespace: f.homeDir,
			host: "other",
			operationId: crypto.randomUUID(),
			url: "https://example.com",
		}),
	).rejects.toThrow("either --namespace or --host");
	await expect(
		runBrowser(navigateBrowser, {
			namespace: f.homeDir,
			operationId: "not-a-uuid",
			url: "https://example.com",
		}),
	).rejects.toThrow();
	await expect(
		runBrowser(navigateBrowser, { url: "https://example.com" }),
	).rejects.toThrow("No active organization");
	expect(f.requests).toEqual([]);
});

test("a navigation conflict retains its operation ID for inspection and is never retried", async () => {
	const f = await fixture();
	f.setDescription({
		capabilities: {
			durableOperations: true,
			workstationBrowserNavigationV1: true,
		} as never,
	});
	f.setNavigationResponse({
		status: 409,
		value: [
			{
				error: {
					json: {
						message: "Operation ID was used with different input",
						code: -32009,
						data: {
							code: "CONFLICT",
							httpStatus: 409,
							path: "direct.browserNavigateV1",
						},
					},
				},
			},
		],
	});
	const input = navigationInput();
	try {
		await runBrowser(navigateBrowser, {
			namespace: f.homeDir,
			operationId: input.operationId,
			url: input.url,
		});
		throw new Error("expected rejection");
	} catch (error) {
		expect((error as Error).message).toContain("different input");
		expect((error as { suggestion?: string }).suggestion).toContain(
			input.operationId,
		);
		expect((error as { suggestion?: string }).suggestion).toContain(
			"operation-status",
		);
	}
	expect(f.requests).toHaveLength(2);
});

test("operation status remains a durable guarded GET when the desktop navigation peer is unavailable", async () => {
	const f = await fixture();
	f.setDescription({
		capabilities: {
			durableOperations: true,
			workstationBrowserNavigationV1: true,
		} as never,
	});
	const input = navigationInput();
	await runBrowser(navigateBrowser, {
		namespace: f.homeDir,
		operationId: input.operationId,
		url: input.url,
	});
	f.setDescription({
		capabilities: {
			durableOperations: true,
			workstationBrowserNavigationV1: false,
		} as never,
	});
	const result = await runBrowser(operationStatus, {
		namespace: f.homeDir,
		operationId: input.operationId,
	});
	expect(result).toEqual({
		data: {
			operationId: input.operationId,
			procedure: "browser.navigateV1",
			status: "completed",
			result: { ok: true },
		},
		message: `${input.operationId}\tbrowser.navigateV1\tcompleted`,
	});
	expect(f.requests.at(-1)).toMatchObject({
		method: "GET",
		authenticated: true,
	});
	expect(
		new URL(f.requests.at(-1)!.path, "http://fixture.invalid").pathname,
	).toBe("/trpc/direct.operationStatus");
	f.setDescription({ capabilities: {} as never });
	await expect(
		runBrowser(operationStatus, {
			namespace: f.homeDir,
			operationId: input.operationId,
		}),
	).rejects.toThrow("capability");
	expect(f.requests.at(-1)!.path).toBe("/direct/describe");
});

test("missing operation status returns an explicit null without issuing a navigation", async () => {
	const f = await fixture();
	f.setDescription({ capabilities: { durableOperations: true } as never });
	expect(
		await runBrowser(operationStatus, {
			namespace: f.homeDir,
			operationId: crypto.randomUUID(),
		}),
	).toEqual({ data: null, message: "Operation not found" });
	expect(f.requests).toHaveLength(2);
	expect(f.requests.every((r) => r.method === "GET")).toBe(true);
});

test("accepted, failed and unresolved receipts never report navigation success or trigger a retry", async () => {
	const f = await fixture();
	f.setDescription({
		capabilities: {
			durableOperations: true,
			workstationBrowserNavigationV1: true,
		} as never,
	});
	for (const status of ["accepted", "failed", "unresolved"]) {
		const input = navigationInput();
		f.setNavigationResponse({
			status: 200,
			value: [
				{
					result: {
						data: {
							json: {
								operationId: input.operationId,
								procedure: "browser.navigateV1",
								status,
							},
						},
					},
				},
			],
		});
		await expect(
			runBrowser(navigateBrowser, {
				namespace: f.homeDir,
				operationId: input.operationId,
				url: input.url,
			}),
		).rejects.toThrow(`Navigation receipt: ${status}`);
	}
	expect(f.requests).toHaveLength(6);
	expect(f.requests.filter((r) => r.method === "POST")).toHaveLength(3);
});

test("namespace eval uses its explicit target without an organization and preserves falsy output", async () => {
	const f = await fixture();
	f.setDescription({
		capabilities: {
			durableOperations: true,
			workstationBrowserEvaluationV1: true,
		} as never,
	});
	expect(
		await runBrowser(evalBrowser, {
			namespace: f.homeDir,
			operationId: crypto.randomUUID(),
			code: "0",
		}),
	).toEqual({ data: { result: 0 }, message: "0" });
});

test("namespace eval preserves strings, structured values, null, false and undefined", async () => {
	const f = await fixture();
	f.setDescription({
		capabilities: {
			durableOperations: true,
			workstationBrowserEvaluationV1: true,
		} as never,
	});
	for (const result of [
		"中文 🙂",
		{ nested: [1, false, null] },
		false,
		null,
		undefined,
	]) {
		f.setEvaluationResult(result);
		expect(
			await runBrowser(evalBrowser, {
				namespace: f.homeDir,
				operationId: crypto.randomUUID(),
				code: "owned-expression",
			}),
		).toEqual({
			data: { result },
			message:
				typeof result === "string" ? result : JSON.stringify(result, null, 2),
		});
	}
	expect(f.requests.filter((r) => r.method === "POST")).toHaveLength(5);
	expect(f.requests.every((r) => r.authenticated)).toBe(true);
});

test("evaluation and navigation transports cannot write each other's operation or batch evaluations", async () => {
	const f = await fixture();
	f.setDescription({
		capabilities: {
			durableOperations: true,
			workstationBrowserEvaluationV1: true,
			workstationBrowserNavigationV1: true,
		} as never,
	});
	const input = {
		operationId: crypto.randomUUID(),
		workspaceId: "owned",
		paneId: "pane",
		code: "0",
	};
	const read = await resolveDirectNamespace(f.homeDir),
		navigation = await resolveBrowserNavigationNamespace(f.homeDir),
		evaluation = await resolveBrowserEvaluationNamespace(f.homeDir);
	await expect(
		read.client.direct.browserEvaluateV1.mutate(input),
	).rejects.toThrow("read-only");
	await expect(
		navigation.client.direct.browserEvaluateV1.mutate(input),
	).rejects.toThrow("read-only");
	await expect(
		evaluation.client.direct.browserNavigateV1.mutate(navigationInput()),
	).rejects.toThrow("read-only");
	await expect(
		evaluation.client.direct.execute.mutate({} as never),
	).rejects.toThrow("read-only");
	await expect(
		Promise.all([
			evaluation.client.direct.browserEvaluateV1.mutate(input),
			evaluation.client.direct.browserEvaluateV1.mutate(input),
		]),
	).rejects.toThrow("read-only");
	expect(f.requests.every((r) => r.path === "/direct/describe")).toBe(true);
});

test("evaluation capability guards reject older or unready backends before a mutation", async () => {
	const f = await fixture();
	for (const capabilities of [
		{},
		{ durableOperations: true },
		{ workstationBrowserEvaluationV1: true },
		{ durableOperations: true, workstationBrowserNavigationV1: true },
	]) {
		f.setDescription({ capabilities: capabilities as never });
		await expect(
			runBrowser(evalBrowser, {
				namespace: f.homeDir,
				operationId: crypto.randomUUID(),
				code: "0",
			}),
		).rejects.toThrow("capability");
	}
	expect(f.requests).toHaveLength(4);
	expect(f.requests.every((r) => r.path === "/direct/describe")).toBe(true);
});

test("eval validates operation and target flags before touching credentials and preserves account defaults", async () => {
	const f = await fixture();
	await expect(
		runBrowser(evalBrowser, { namespace: f.homeDir, code: "0" }),
	).rejects.toThrow("requires --operation-id");
	await expect(
		runBrowser(evalBrowser, { operationId: crypto.randomUUID(), code: "0" }),
	).rejects.toThrow("requires --namespace");
	await expect(
		runBrowser(evalBrowser, {
			namespace: f.homeDir,
			host: "other",
			operationId: crypto.randomUUID(),
			code: "0",
		}),
	).rejects.toThrow("either --namespace or --host");
	await expect(
		runBrowser(evalBrowser, {
			namespace: f.homeDir,
			operationId: "invalid",
			code: "0",
		}),
	).rejects.toThrow();
	await expect(runBrowser(evalBrowser, { code: "0" })).rejects.toThrow(
		"No active organization",
	);
	expect(f.requests).toEqual([]);
});

test("an evaluation failure includes the stable operation ID and is not retried", async () => {
	const f = await fixture();
	f.setDescription({
		capabilities: {
			durableOperations: true,
			workstationBrowserEvaluationV1: true,
		} as never,
	});
	f.setEvaluationResponse({
		status: 412,
		value: [
			{
				error: {
					json: {
						message: "This operation is unresolved",
						code: -32012,
						data: { code: "PRECONDITION_FAILED", httpStatus: 412 },
					},
				},
			},
		],
	});
	const operationId = crypto.randomUUID();
	try {
		await runBrowser(evalBrowser, {
			namespace: f.homeDir,
			operationId,
			code: "0",
		});
		throw Error("Expected failure");
	} catch (error) {
		expect((error as Error).message).toContain("unresolved");
		expect((error as { suggestion: string }).suggestion).toContain(operationId);
		expect((error as { suggestion: string }).suggestion).toContain(
			"operation-status",
		);
	}
	expect(f.requests).toHaveLength(2);
});

test("the eval parser accepts the existing code flag and new explicit operation ID", () => {
	const configs = Object.fromEntries(
		Object.entries(evalBrowser.options!).map(([name, builder]) => [
			name,
			{ ...builder._.config, name: camelToKebab(name) },
		]),
	);
	const operationId = crypto.randomUUID();
	expect(
		parseArgv(
			[
				"bun",
				"superset",
				"--namespace",
				"/tmp/Namespace 中文",
				"--operation-id",
				operationId,
				"--workspace",
				"owned",
				"--pane",
				"pane",
				"--code",
				"void 0",
			],
			configs,
		).options,
	).toMatchObject({
		namespace: "/tmp/Namespace 中文",
		operationId,
		workspace: "owned",
		pane: "pane",
		code: "void 0",
	});
});

test("evaluation status preserves undefined while the execution peer is unavailable", async () => {
	const f = await fixture(),
		operationId = crypto.randomUUID();
	f.setDescription({
		capabilities: {
			durableOperations: true,
			workstationBrowserEvaluationV1: true,
		} as never,
	});
	f.setEvaluationResult(undefined);
	await runBrowser(evalBrowser, {
		namespace: f.homeDir,
		operationId,
		code: "void 0",
	});
	f.setDescription({
		capabilities: {
			durableOperations: true,
			workstationBrowserEvaluationV1: false,
		} as never,
	});
	const result = await runBrowser(operationStatus, {
		namespace: f.homeDir,
		operationId,
	});
	expect(result).toEqual({
		data: {
			operationId,
			procedure: "browser.evaluateV1",
			status: "completed",
			result: { result: undefined },
		},
		message: `${operationId}\tbrowser.evaluateV1\tcompleted`,
	});
	expect(f.requests.at(-1)?.method).toBe("GET");
});

test("incomplete or malformed evaluation receipts cannot be mistaken for successful execution", async () => {
	const f = await fixture();
	f.setDescription({
		capabilities: {
			durableOperations: true,
			workstationBrowserEvaluationV1: true,
		} as never,
	});
	for (const status of ["accepted", "failed", "unresolved", "completed"]) {
		const operationId = crypto.randomUUID();
		f.setEvaluationResponse({
			status: 200,
			value: [
				{
					result: {
						data: {
							json: {
								operationId,
								procedure: "browser.evaluateV1",
								status,
								result: {},
							},
						},
					},
				},
			],
		});
		await expect(
			runBrowser(evalBrowser, { namespace: f.homeDir, operationId, code: "0" }),
		).rejects.toThrow(`Evaluation receipt: ${status}`);
	}
	expect(f.requests.filter((r) => r.method === "POST")).toHaveLength(4);
});

test("namespace open uses one protected explicit-target mutation and preserves the existing output format", async () => {
	const f = await fixture(),
		operationId = crypto.randomUUID(),
		url = "https://owned.invalid/中文";
	f.setDescription({
		capabilities: {
			durableOperations: true,
			workstationBrowserOpenV1: true,
		} as never,
	});
	expect(
		await runBrowser(openBrowser, { namespace: f.homeDir, operationId, url }),
	).toEqual({
		data: { paneId: "owned-open", url, title: "Owned 标题" },
		message: `Opened ${url}\npane: owned-open`,
	});
	expect(f.requests).toHaveLength(2);
	expect(f.requests.at(-1)).toMatchObject({
		method: "POST",
		authenticated: true,
		body: {
			operationId,
			workspaceId: "owned",
			url,
			target: "current-tab",
			show: false,
		},
	});
});
test("namespace open forwards explicit new-tab and show intent without changing default fields", async () => {
	const f = await fixture(),
		operationId = crypto.randomUUID();
	f.setDescription({
		capabilities: {
			durableOperations: true,
			workstationBrowserOpenV1: true,
		} as never,
	});
	await runBrowser(openBrowser, {
		namespace: f.homeDir,
		operationId,
		url: "about:blank",
		target: "new-tab",
		show: true,
	});
	expect(f.requests.at(-1)?.body).toEqual({
		operationId,
		workspaceId: "owned",
		url: "about:blank",
		target: "new-tab",
		show: true,
	});
});
test("namespace open validates operation and target flags before credentials and leaves account routing intact", async () => {
	const f = await fixture();
	await expect(
		runBrowser(openBrowser, { namespace: f.homeDir, url: "about:blank" }),
	).rejects.toThrow("requires --operation-id");
	await expect(
		runBrowser(openBrowser, {
			operationId: crypto.randomUUID(),
			url: "about:blank",
		}),
	).rejects.toThrow("requires --namespace");
	await expect(
		runBrowser(openBrowser, {
			namespace: f.homeDir,
			host: "other",
			operationId: crypto.randomUUID(),
			url: "about:blank",
		}),
	).rejects.toThrow("either --namespace or --host");
	await expect(
		runBrowser(openBrowser, {
			namespace: f.homeDir,
			operationId: "invalid",
			url: "about:blank",
		}),
	).rejects.toThrow();
	await expect(
		runBrowser(openBrowser, {
			namespace: f.homeDir,
			operationId: crypto.randomUUID(),
			url: "about:blank",
			target: "invalid",
		}),
	).rejects.toThrow();
	await expect(runBrowser(openBrowser, { url: "about:blank" })).rejects.toThrow(
		"No active organization",
	);
	expect(f.requests).toEqual([]);
});
test("open readiness and durable capability are required before the mutation is sent", async () => {
	const f = await fixture();
	for (const capabilities of [
		{},
		{ durableOperations: true },
		{ workstationBrowserOpenV1: true },
		{ durableOperations: true, workstationBrowserEvaluationV1: true },
	]) {
		f.setDescription({ capabilities: capabilities as never });
		await expect(
			runBrowser(openBrowser, {
				namespace: f.homeDir,
				operationId: crypto.randomUUID(),
				url: "about:blank",
			}),
		).rejects.toThrow("capability");
	}
	expect(f.requests).toHaveLength(4);
	expect(f.requests.every((r) => r.path === "/direct/describe")).toBe(true);
});
test("open, evaluation, navigation and read transports keep their single-mutation boundaries", async () => {
	const f = await fixture();
	f.setDescription({
		capabilities: {
			durableOperations: true,
			workstationBrowserOpenV1: true,
			workstationBrowserEvaluationV1: true,
			workstationBrowserNavigationV1: true,
		} as never,
	});
	const opening = await resolveBrowserOpenNamespace(f.homeDir),
		evaluation = await resolveBrowserEvaluationNamespace(f.homeDir),
		navigation = await resolveBrowserNavigationNamespace(f.homeDir),
		read = await resolveDirectNamespace(f.homeDir),
		input = {
			operationId: crypto.randomUUID(),
			workspaceId: "owned",
			url: "about:blank",
		};
	for (const target of [read, evaluation, navigation])
		await expect(
			target.client.direct.browserOpenV1.mutate(input),
		).rejects.toThrow("read-only");
	await expect(
		opening.client.direct.browserEvaluateV1.mutate({
			...input,
			paneId: "pane",
			code: "0",
		}),
	).rejects.toThrow("read-only");
	await expect(
		opening.client.direct.browserNavigateV1.mutate({
			...input,
			paneId: "pane",
		}),
	).rejects.toThrow("read-only");
	await expect(
		opening.client.direct.execute.mutate({} as never),
	).rejects.toThrow("read-only");
	const batch = await Promise.allSettled([
		opening.client.direct.browserOpenV1.mutate(input),
		opening.client.direct.browserOpenV1.mutate(input),
	]);
	expect(batch.map((result) => result.status)).toEqual([
		"rejected",
		"rejected",
	]);
	expect(f.requests).toHaveLength(4);
});
test("an opening failure includes its stable ID and status inspection advice without retrying", async () => {
	const f = await fixture(),
		operationId = crypto.randomUUID();
	f.setDescription({
		capabilities: {
			durableOperations: true,
			workstationBrowserOpenV1: true,
		} as never,
	});
	f.setOpenResponse({
		status: 412,
		value: [
			{
				error: {
					json: {
						message: "This operation is unresolved",
						code: -32012,
						data: { code: "PRECONDITION_FAILED", httpStatus: 412 },
					},
				},
			},
		],
	});
	try {
		await runBrowser(openBrowser, {
			namespace: f.homeDir,
			operationId,
			url: "about:blank",
		});
		throw Error("Expected opening failure");
	} catch (error) {
		expect((error as Error).message).toContain("unresolved");
		expect((error as { suggestion: string }).suggestion).toContain(operationId);
		expect((error as { suggestion: string }).suggestion).toContain(
			"operation-status",
		);
	}
	expect(f.requests).toHaveLength(2);
	expect(f.requests.filter((r) => r.method === "POST")).toHaveLength(1);
});
test("incomplete and malformed open receipts never report success or replay the intent", async () => {
	const f = await fixture();
	f.setDescription({
		capabilities: {
			durableOperations: true,
			workstationBrowserOpenV1: true,
		} as never,
	});
	let cases = 0;
	for (const status of ["accepted", "failed", "unresolved", "completed"]) {
		const operationId = crypto.randomUUID();
		f.setOpenResponse({
			status: 200,
			value: [
				{
					result: {
						data: SuperJSON.serialize({
							operationId,
							procedure: "browser.openV1",
							status,
						}),
					},
				},
			],
		});
		await expect(
			runBrowser(openBrowser, {
				namespace: f.homeDir,
				operationId,
				url: "about:blank",
			}),
		).rejects.toThrow("Browser open receipt");
		cases++;
	}
	f.setOpenResponse(null);
	for (const result of [
		null,
		{},
		{ paneId: "", url: "about:blank", title: "" },
		{ paneId: "owned", url: false, title: "" },
		{ paneId: "owned", url: "about:blank", title: 1 },
	]) {
		f.setOpenResult(result);
		await expect(
			runBrowser(openBrowser, {
				namespace: f.homeDir,
				operationId: crypto.randomUUID(),
				url: "about:blank",
			}),
		).rejects.toThrow("Browser open receipt");
		cases++;
	}
	expect(f.requests.filter((r) => r.method === "POST")).toHaveLength(cases);
	expect(f.requests).toHaveLength(cases * 2);
});
test("completed open status remains available through a guarded GET after renderer readiness is lost", async () => {
	const f = await fixture(),
		operationId = crypto.randomUUID();
	f.setDescription({
		capabilities: {
			durableOperations: true,
			workstationBrowserOpenV1: true,
		} as never,
	});
	await runBrowser(openBrowser, {
		namespace: f.homeDir,
		operationId,
		url: "about:blank",
	});
	f.setDescription({ capabilities: { durableOperations: true } as never });
	await expect(
		runBrowser(openBrowser, {
			namespace: f.homeDir,
			operationId,
			url: "about:blank",
		}),
	).rejects.toThrow("capability");
	const status = await runBrowser(operationStatus, {
		namespace: f.homeDir,
		operationId,
	});
	expect(status).toEqual({
		data: {
			operationId,
			procedure: "browser.openV1",
			status: "completed",
			result: { paneId: "owned-open", url: "about:blank", title: "Owned 标题" },
		},
		message: `${operationId}\tbrowser.openV1\tcompleted`,
	});
	expect(f.requests.filter((r) => r.method === "POST")).toHaveLength(1);
	expect(f.requests.at(-1)?.method).toBe("GET");
});
test("the original open parser accepts namespace, stable operation ID, target and show flags", () => {
	const configs = Object.fromEntries(
		Object.entries(openBrowser.options!).map(([name, builder]) => [
			name,
			{ ...builder._.config, name: camelToKebab(name) },
		]),
	);
	const parsed = parseArgv(
		[
			"bun",
			"superset",
			"--namespace",
			"/owned",
			"--operation-id",
			"00000000-0000-4000-8000-000000000117",
			"--workspace",
			"workspace",
			"--url",
			"about:blank",
			"--target",
			"new-tab",
			"--show",
		],
		configs,
	);
	expect(parsed.options.namespace).toBe("/owned");
	expect(parsed.options.operationId).toBe(
		"00000000-0000-4000-8000-000000000117",
	);
	expect(parsed.options.target).toBe("new-tab");
	expect(parsed.options.show).toBe(true);
});

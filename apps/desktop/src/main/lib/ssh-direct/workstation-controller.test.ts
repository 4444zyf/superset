import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import type { SqliteDatabase } from "@superset/direct-connection";
import { OperationIntents } from "./operation-intents";
import { WorkstationController } from "./workstation-controller";

test("new feedback agents require capability and durable tracking before the original launch pipeline runs", async () => {
	const f = fixture(),
		db = new Database(":memory:");
	let enabled = false;
	const calls: unknown[] = [],
		intents = new OperationIntents(db as unknown as SqliteDatabase);
	const manager = {
		...f.manager,
		getVerifiedDescription: () => ({
			capabilities: {
				workstationAgentFeedbackV1: true,
				workstationAgentHooksV1: enabled,
				durableOperations: true,
			},
		}),
		invoke: async (_id: string, request: unknown) => {
			calls.push(request);
			return {
				status: "completed",
				result: { kind: "terminal", sessionId: "terminal", label: "Owned" },
			};
		},
	};
	const request = {
		connectionId: "machine",
		generation: 1,
		path: "agents.run",
		type: "mutation" as const,
		input: {
			workspaceId: "workspace",
			agent: "config",
			prompt: "owned feedback",
			surface: "terminal",
			operationId: crypto.randomUUID(),
		},
	};
	try {
		const controller = new WorkstationController(manager, intents);
		await expect(controller.invoke(request)).rejects.toThrow(
			"required capability",
		);
		enabled = true;
		await expect(
			new WorkstationController(manager).invoke(request),
		).rejects.toThrow("tracking");
		expect(calls).toEqual([]);
		expect(await controller.invoke(request)).toEqual({
			kind: "terminal",
			sessionId: "terminal",
			label: "Owned",
		});
		expect(calls[0]).toMatchObject({
			path: "direct.execute",
			input: {
				operationId: request.input.operationId,
				procedure: "agents.run",
				input: {
					agent: "config",
					prompt: "owned feedback",
					surface: "terminal",
				},
			},
		});
	} finally {
		db.close();
	}
});

test("agent target reads require the optional capability and an explicit current workspace", async () => {
	const f = fixture();
	let enabled: unknown = false;
	const calls: unknown[] = [];
	const controller = new WorkstationController({
		...f.manager,
		getVerifiedDescription: () => ({
			capabilities: { workstationAgentFeedbackV1: enabled },
		}),
		invoke: async (_id, request) => {
			calls.push(request);
			return [];
		},
	});
	const request = {
		connectionId: "machine",
		generation: 1,
		path: "terminalAgents.listByWorkspace",
		type: "query" as const,
		input: { workspaceId: "workspace" },
	};
	for (const value of [undefined, false, "true", 1]) {
		enabled = value;
		await expect(controller.invoke(request)).rejects.toThrow(
			"required capability",
		);
	}
	enabled = true;
	await expect(
		controller.invoke({ ...request, input: { workspaceId: "" } }),
	).rejects.toThrow("explicit workspace");
	await expect(
		controller.invoke({ ...request, type: "mutation" }),
	).rejects.toThrow("Unsupported");
	expect(calls).toEqual([]);
	expect(await controller.invoke(request)).toEqual([]);
	f.nextGeneration();
	await expect(controller.invoke(request)).rejects.toThrow(
		"Connection changed",
	);
	expect(calls).toHaveLength(1);
});

test("agent feedback uses durable dispatch and rejects sending without operation tracking", async () => {
	const f = fixture(),
		db = new Database(":memory:");
	const intents = new OperationIntents(db as unknown as SqliteDatabase),
		calls: unknown[] = [];
	const manager = {
		...f.manager,
		getVerifiedDescription: () => ({
			capabilities: {
				workstationAgentFeedbackV1: true,
				durableOperations: true,
			},
		}),
		invoke: async (_id: string, request: unknown) => {
			calls.push(request);
			return { status: "completed", result: { submitted: true } };
		},
	};
	const request = {
		connectionId: "machine",
		generation: 1,
		path: "terminal.sendToAgentV1",
		type: "mutation" as const,
		input: {
			workspaceId: "workspace",
			terminalId: "terminal",
			executionId: "execution",
			agent: { agentId: "claude", startedAt: 1 },
			text: "feedback",
			operationId: crypto.randomUUID(),
		},
	};
	try {
		await expect(
			new WorkstationController(manager).invoke(request),
		).rejects.toThrow("tracking");
		expect(calls).toEqual([]);
		const controller = new WorkstationController(manager, intents);
		await expect(
			controller.invoke({
				...request,
				input: { ...request.input, operationId: "" },
			}),
		).rejects.toThrow("stable operation ID");
		expect(await controller.invoke(request)).toEqual({ submitted: true });
		expect(calls).toEqual([
			{
				path: "direct.execute",
				type: "mutation",
				input: {
					operationId: request.input.operationId,
					procedure: "terminal.sendToAgentV1",
					input: {
						workspaceId: "workspace",
						terminalId: "terminal",
						executionId: "execution",
						agent: { agentId: "claude", startedAt: 1 },
						text: "feedback",
					},
				},
			},
		]);
		expect(intents.list("machine")).toEqual([]);
	} finally {
		db.close();
	}
});

test("an unknown agent-send receipt remains pending instead of being treated as success", async () => {
	const f = fixture(),
		db = new Database(":memory:");
	try {
		const intents = new OperationIntents(db as unknown as SqliteDatabase);
		const controller = new WorkstationController(
			{
				...f.manager,
				getVerifiedDescription: () => ({
					capabilities: {
						workstationAgentFeedbackV1: true,
						durableOperations: true,
					},
				}),
				invoke: async () => {
					throw Error("owned receipt lost");
				},
			},
			intents,
		);
		const operationId = crypto.randomUUID();
		await expect(
			controller.invoke({
				connectionId: "machine",
				generation: 1,
				path: "terminal.sendToAgentV1",
				type: "mutation",
				input: { workspaceId: "workspace", operationId },
			}),
		).rejects.toThrow("receipt lost");
		expect(intents.list("machine")).toHaveLength(1);
		expect(intents.list("machine")[0].operationId).toBe(operationId);
	} finally {
		db.close();
	}
});

test("port close uses the original scoped mutation and rejects old capability and stale generation", async () => {
	const f = fixture();
	let enabled = false;
	const calls: unknown[] = [];
	const result = { success: false, error: "not owned" };
	const controller = new WorkstationController({
		...f.manager,
		getVerifiedDescription: () => ({
			capabilities: { workstationPortsV1: enabled },
		}),
		invoke: async (id, request) => {
			calls.push({ id, ...request });
			return result;
		},
	});
	await expect(
		controller.killWorkspacePort("machine", 1, "workspace", "terminal", 3000),
	).rejects.toThrow("required capability");
	enabled = true;
	await expect(
		controller.killWorkspacePort("machine", 1, "", "terminal", 3000),
	).rejects.toThrow("explicit workspace");
	expect(
		await controller.killWorkspacePort(
			"machine",
			1,
			"workspace",
			"terminal",
			3000,
		),
	).toBe(result);
	expect(calls).toEqual([
		{
			id: "machine",
			path: "ports.kill",
			type: "mutation",
			input: { workspaceId: "workspace", terminalId: "terminal", port: 3000 },
		},
	]);
	await expect(
		controller.invoke({
			connectionId: "machine",
			generation: 1,
			path: "ports.kill",
			type: "mutation",
			input: { workspaceId: "workspace", terminalId: "terminal", port: 3000 },
		}),
	).rejects.toThrow("Unsupported");
	f.nextGeneration();
	await expect(
		controller.killWorkspacePort("machine", 1, "workspace", "terminal", 3000),
	).rejects.toThrow("Connection changed");
	expect(calls).toHaveLength(1);
});

test("a generation change during capability lookup prevents the port kill mutation", async () => {
	const f = fixture();
	const calls: unknown[] = [];
	const controller = new WorkstationController({
		...f.manager,
		getVerifiedDescription: () => ({
			capabilities: { workstationPortsV1: true },
		}),
		invoke: async (...args) => {
			calls.push(args);
			return { success: true };
		},
	});
	const closing = controller.killWorkspacePort(
		"machine",
		1,
		"workspace",
		"terminal",
		3000,
	);
	f.nextGeneration();
	await expect(closing).rejects.toThrow("Connection changed");
	expect(calls).toEqual([]);
});

test("port discovery preserves the existing getAll query and requires capability, workspace and generation", async () => {
	const f = fixture();
	let enabled = false;
	const calls: unknown[] = [];
	const ports = [
		{
			port: 3000,
			workspaceId: "workspace",
			terminalId: "terminal",
			label: null,
		},
	];
	const controller = new WorkstationController({
		...f.manager,
		getVerifiedDescription: () => ({
			capabilities: { workstationPortsV1: enabled },
		}),
		invoke: async (id, request) => {
			calls.push({ id, ...request });
			return ports;
		},
	});
	await expect(controller.listPorts("machine", 1, "workspace")).rejects.toThrow(
		"required capability",
	);
	enabled = true;
	await expect(controller.listPorts("machine", 1, "")).rejects.toThrow(
		"explicit workspace",
	);
	expect(await controller.listPorts("machine", 1, "workspace")).toBe(ports);
	expect(calls).toEqual([
		{
			id: "machine",
			path: "ports.getAll",
			type: "query",
			input: { workspaceIds: ["workspace"] },
		},
	]);
	await expect(
		controller.invoke({
			connectionId: "machine",
			generation: 1,
			path: "ports.getAll",
			type: "query",
			input: { workspaceIds: ["workspace"] },
		}),
	).rejects.toThrow("Unsupported");
	f.nextGeneration();
	await expect(controller.listPorts("machine", 1, "workspace")).rejects.toThrow(
		"Connection changed",
	);
	expect(calls).toHaveLength(1);
});

test("a port read cannot finish after the connection generation changes", async () => {
	const f = fixture();
	let finish!: (ports: unknown[]) => void;
	let notify!: () => void;
	const started = new Promise<void>((resolve) => {
		notify = resolve;
	});
	const pending = new Promise<unknown[]>((resolve) => {
		finish = resolve;
	});
	const controller = new WorkstationController({
		...f.manager,
		getVerifiedDescription: () => ({
			capabilities: { workstationPortsV1: true },
		}),
		invoke: async () => {
			notify();
			return pending;
		},
	});
	const reading = controller.listPorts("machine", 1, "workspace");
	await started;
	f.nextGeneration();
	finish([]);
	await expect(reading).rejects.toThrow("Connection changed");
});

test("terminal path resolution preserves the existing mutation contract and requires workspace capability and generation", async () => {
	const f = fixture();
	let enabled = false;
	const requests: unknown[] = [];
	const controller = new WorkstationController({
		...f.manager,
		getVerifiedDescription: () => ({
			capabilities: { workstationFilesV1: enabled },
		}),
		invoke: async (_id, request) => {
			requests.push(request);
			return { resolvedPath: "/remote/repo/note.txt", isDirectory: false };
		},
	});
	const request = {
		connectionId: "machine",
		generation: 1,
		path: "filesystem.statPath",
		type: "mutation" as const,
		input: { workspaceId: "workspace", path: "note.txt" },
	};
	await expect(controller.invoke(request)).rejects.toThrow(
		"required capability",
	);
	enabled = true;
	await expect(
		controller.invoke({ ...request, type: "query" }),
	).rejects.toThrow("Unsupported");
	await expect(
		controller.invoke({ ...request, input: { path: "note.txt" } }),
	).rejects.toThrow("explicit workspace");
	expect(await controller.invoke(request)).toEqual({
		resolvedPath: "/remote/repo/note.txt",
		isDirectory: false,
	});
	f.nextGeneration();
	await expect(controller.invoke(request)).rejects.toThrow(
		"Connection changed",
	);
	expect(requests).toEqual([request]);
});

test("project settings require an explicit project and an advertised backend capability", async () => {
	const f = fixture();
	const requests: unknown[] = [];
	let enabled = false;
	const controller = new WorkstationController({
		...f.manager,
		getVerifiedDescription: () => ({
			capabilities: { workstationProjectsV1: enabled },
		}),
		invoke: async (id, request) => {
			requests.push({ id, ...request });
			return { success: true };
		},
	});
	const request = {
		connectionId: "machine",
		generation: 1,
		path: "project.get",
		type: "query" as const,
		input: { projectId: "project" },
	};
	await expect(controller.invoke(request)).rejects.toThrow(
		"required capability",
	);
	enabled = true;
	await expect(controller.invoke({ ...request, input: {} })).rejects.toThrow(
		"explicit project",
	);
	await controller.invoke(request);
	for (const [path, input] of [
		["project.update", { name: "Renamed" }],
		["project.setColor", { color: "#aabbcc" }],
		["project.setIcon", { icon: "none" }],
		["project.setBranchPrefix", { mode: "custom", customPrefix: "feature" }],
		["project.setNamingInstructions", { instructions: "Use task name" }],
		["project.setSparseCheckoutPaths", { paths: ["packages/ui"] }],
	] as const)
		await controller.invoke({
			...request,
			path,
			type: "mutation",
			input: { projectId: "project", ...input },
		});
	expect(requests).toHaveLength(7);
	expect(requests[0]).toMatchObject({
		id: "machine",
		path: "project.get",
		type: "query",
		input: { projectId: "project" },
	});
});

test("workspace file search and Git staging reach the selected backend without cloud calls", async () => {
	const f = fixture();
	const requests: unknown[] = [];
	const controller = new WorkstationController({
		...f.manager,
		getVerifiedDescription: () => ({
			capabilities: { workstationFilesV1: true, workstationGitV1: true },
		}),
		invoke: async (id, request) => {
			requests.push({ id, ...request });
			return { success: true };
		},
	});
	await controller.invoke({
		connectionId: "machine",
		generation: 1,
		path: "filesystem.searchContent",
		type: "query",
		input: { workspaceId: "workspace", query: "needle", limit: 100 },
	});
	await controller.invoke({
		connectionId: "machine",
		generation: 1,
		path: "git.stageFile",
		type: "mutation",
		input: { workspaceId: "workspace", filePath: "notes.txt" },
	});
	expect(requests).toEqual([
		{
			id: "machine",
			path: "filesystem.searchContent",
			type: "query",
			input: { workspaceId: "workspace", query: "needle", limit: 100 },
			connectionId: "machine",
			generation: 1,
		},
		{
			id: "machine",
			path: "git.stageFile",
			type: "mutation",
			input: { workspaceId: "workspace", filePath: "notes.txt" },
			connectionId: "machine",
			generation: 1,
		},
	]);
});

test("new file and Git actions are unavailable on an older backend before any mutation", async () => {
	const f = fixture();
	const controller = new WorkstationController({
		...f.manager,
		getVerifiedDescription: () => ({
			capabilities: { files: true, git: true },
		}),
	});
	await expect(
		controller.invoke({
			connectionId: "machine",
			generation: 1,
			path: "git.stageAll",
			type: "mutation",
			input: { workspaceId: "workspace" },
		}),
	).rejects.toThrow("capability");
	expect(f.calls).toEqual([]);
});

test("new workspace actions reject a missing scope and wrong procedure type", async () => {
	const f = fixture();
	const controller = new WorkstationController({
		...f.manager,
		getVerifiedDescription: () => ({
			capabilities: { workstationFilesV1: true },
		}),
	});
	await expect(
		controller.invoke({
			connectionId: "machine",
			generation: 1,
			path: "filesystem.searchFiles",
			type: "query",
			input: { projectId: "elsewhere", query: "x" },
		}),
	).rejects.toThrow("workspace");
	await expect(
		controller.invoke({
			connectionId: "machine",
			generation: 1,
			path: "filesystem.movePath",
			type: "query",
			input: { workspaceId: "workspace" },
		}),
	).rejects.toThrow("Unsupported");
	expect(f.calls).toEqual([]);
});

test("a lost Git commit response remains journaled and prevents a second commit", async () => {
	const db = new Database(":memory:");
	const intents = new OperationIntents(db as unknown as SqliteDatabase);
	const f = fixture();
	const requests: unknown[] = [];
	const controller = new WorkstationController(
		{
			...f.manager,
			getVerifiedDescription: () => ({
				capabilities: { workstationGitV1: true, durableOperations: true },
			}),
			invoke: async (_id, request) => {
				requests.push(request);
				throw new Error("Response lost");
			},
		},
		intents,
	);
	const operationId = "1046dcad-c30b-4868-80e3-d61bf5ea64c8";
	const input = {
		workspaceId: "workspace",
		message: "Commit selected changes",
		stageAll: false,
		operationId,
	};
	try {
		await expect(
			controller.invoke({
				connectionId: "machine",
				generation: 1,
				path: "git.commit",
				type: "mutation",
				input,
			}),
		).rejects.toThrow("Response lost");
		expect(intents.list("machine")).toMatchObject([
			{ operationId, procedure: "git.commit" },
		]);
		await expect(
			controller.invoke({
				connectionId: "machine",
				generation: 1,
				path: "git.commit",
				type: "mutation",
				input: {
					...input,
					operationId: "b8e2eb57-173e-461a-84e9-ff8029795a27",
				},
			}),
		).rejects.toThrow("pending");
		expect(requests).toEqual([
			{
				path: "direct.execute",
				type: "mutation",
				input: {
					operationId,
					procedure: "git.commit",
					input: {
						workspaceId: "workspace",
						message: "Commit selected changes",
						stageAll: false,
					},
				},
			},
		]);
	} finally {
		db.close();
	}
});

function fixture() {
	const calls: string[] = [];
	let generation = 1;
	const manager = {
		getLease: () => ({
			connectionId: "machine",
			generation,
			backendId: "backend",
			namespaceId: "namespace",
			instanceId: "instance",
			url: "http://127.0.0.1:5678",
			secret: "private",
		}),
		invoke: async (
			_id: string,
			_request: { path: string; type: "query" | "mutation"; input?: unknown },
		): Promise<unknown> => {
			calls.push("invoke");
			return { ok: true };
		},
		request: async (_id: string, _input: unknown) =>
			new Response(JSON.stringify({ result: { data: [{ id: "chat" }] } })),
		disconnect: async () => {
			calls.push("disconnect");
		},
		dispose: async () => {
			calls.push("dispose");
		},
		openSocket: () => new EventTarget(),
	};
	return {
		calls,
		manager,
		nextGeneration: () => {
			generation += 1;
		},
		controller: new WorkstationController(manager),
	};
}

test("restoration capabilities from a changed backend cannot authorize attachment", async () => {
	const f = fixture();
	f.manager.request = async () =>
		new Response(
			JSON.stringify({
				backendId: "different",
				namespaceId: "namespace",
				capabilities: { workspaceViewRestoreV1: true },
			}),
		);
	await expect(f.controller.features("machine", true)).rejects.toThrow(
		"identity",
	);
});

test("window restore inspects pending work without resolving the operation journal or replaying a mutation", async () => {
	const db = new Database(":memory:");
	const intents = new OperationIntents(db as unknown as SqliteDatabase);
	intents.begin({
		connectionId: "machine",
		backendId: "backend",
		namespaceId: "namespace",
		operationId: "operation",
		procedure: "chat.prompt",
		inputHash: "digest",
	});
	const f = fixture();
	const requests: { path: string; type: string; input?: unknown }[] = [];
	f.manager.invoke = async (_id, request) => {
		requests.push(request);
		return { status: "completed" };
	};
	const controller = new WorkstationController(f.manager, intents);
	const before = JSON.stringify(intents.list("machine"));
	const result = await controller.inspectPending("machine");
	expect(result).toMatchObject([
		{ operationId: "operation", status: "completed" },
	]);
	expect(JSON.stringify(intents.list("machine"))).toBe(before);
	expect(requests).toEqual([
		{
			path: "direct.operationStatus",
			type: "query",
			input: { operationId: "operation" },
		},
	]);
	db.close();
});

test("renderer connection descriptors omit endpoint credentials and addresses", () => {
	const { controller } = fixture();
	expect(controller.describe("machine")).toEqual({
		connectionId: "machine",
		generation: 1,
		backendId: "backend",
		namespaceId: "namespace",
		instanceId: "instance",
	});
});

test("a stale renderer cannot issue a mutation after reconnect", async () => {
	const { controller, calls, nextGeneration } = fixture();
	nextGeneration();
	await expect(
		controller.invoke({
			connectionId: "machine",
			generation: 1,
			path: "workspaces.createSession",
			type: "mutation",
			input: { id: "session" },
		}),
	).rejects.toThrow("Connection changed");
	expect(calls).toEqual([]);
});

test("renderer RPC cannot call destructive daemon or official account procedures", async () => {
	const { controller, calls } = fixture();
	for (const path of [
		"terminal.daemon.restart",
		"system.update",
		"auth.login",
	]) {
		await expect(
			controller.invoke({
				connectionId: "machine",
				generation: 1,
				path,
				type: "mutation",
				input: {},
			}),
		).rejects.toThrow("Unsupported workstation procedure");
	}
	expect(calls).toEqual([]);
});

test("chat requests use the local chat router without serializing a host secret", async () => {
	const { manager } = fixture();
	let request: unknown;
	manager.request = async (_id: string, input: unknown) => {
		request = input;
		return new Response(JSON.stringify({ result: { data: [{ id: "chat" }] } }));
	};
	const controller = new WorkstationController(manager);
	expect(
		await controller.invoke({
			connectionId: "machine",
			generation: 1,
			path: "chat.listSessions",
			type: "query",
			input: { workspaceId: "workspace" },
		}),
	).toEqual([{ id: "chat" }]);
	expect(JSON.stringify(request)).toContain("/chat-v3/trpc/listSessions");
	expect(JSON.stringify(request)).not.toContain("private");
});

test("disconnect and app disposal only close client transports", async () => {
	const { controller, calls } = fixture();
	await controller.disconnect("machine");
	await controller.dispose();
	expect(calls).toEqual(["disconnect", "dispose"]);
});

test("lost mutation responses remain pending across controller restart and prevent duplicate agents", async () => {
	const { manager } = fixture();
	let calls = 0;
	manager.invoke = async () => {
		calls += 1;
		throw new Error("SSH disconnected after acceptance");
	};
	const db = new Database(":memory:");
	const intents = new OperationIntents(db as unknown as SqliteDatabase);
	const request = {
		connectionId: "machine",
		generation: 1,
		path: "chat.prompt",
		type: "mutation" as const,
		input: {
			commandId: "0f9c00ca-67c8-4f1d-ac3e-ea7eebbf126c",
			sessionId: "session",
			content: [{ type: "text", text: "private prompt" }],
		},
	};
	await expect(
		new WorkstationController(manager, intents).invoke(request),
	).rejects.toThrow("SSH disconnected");
	await expect(
		new WorkstationController(manager, intents).invoke({
			...request,
			input: {
				...request.input,
				commandId: "1f9c00ca-67c8-4f1d-ac3e-ea7eebbf126c",
			},
		}),
	).rejects.toThrow("Reconcile");
	expect(calls).toBe(1);
	expect(JSON.stringify(intents.list("machine"))).not.toContain(
		"private prompt",
	);
	db.close();
});

test("retrying the same operation with reordered object keys keeps its input identity", async () => {
	const { manager } = fixture();
	manager.invoke = async () => {
		throw new Error("Response lost");
	};
	const db = new Database(":memory:");
	const controller = new WorkstationController(
		manager,
		new OperationIntents(db as unknown as SqliteDatabase),
	);
	const request = {
		connectionId: "machine",
		generation: 1,
		path: "chat.prompt",
		type: "mutation" as const,
	};
	const commandId = "0f9c00ca-67c8-4f1d-ac3e-ea7eebbf126c";
	await expect(
		controller.invoke({
			...request,
			input: { commandId, sessionId: "session", content: [] },
		}),
	).rejects.toThrow("Response lost");
	await expect(
		controller.invoke({
			...request,
			input: { content: [], sessionId: "session", commandId },
		}),
	).rejects.toThrow("Response lost");
	db.close();
});

test("acknowledging an unresolved action clears only local blocking and never replays the operation", async () => {
	const { manager } = fixture();
	const calls: string[] = [];
	manager.invoke = async (_id: string, request: { path: string }) => {
		calls.push(request.path);
		return { status: "unresolved" };
	};
	const db = new Database(":memory:");
	const intents = new OperationIntents(db as unknown as SqliteDatabase);
	intents.begin({
		connectionId: "machine",
		backendId: "backend",
		namespaceId: "namespace",
		operationId: "operation",
		procedure: "chat.prompt",
		inputHash: "digest",
	});
	const controller = new WorkstationController(manager, intents);
	await controller.acknowledge("machine", 1, "operation");
	expect(intents.list("machine")).toEqual([]);
	expect(calls).toEqual(["direct.operationStatus"]);
	db.close();
});

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((settle) => {
		resolve = settle;
	});
	return { promise, resolve };
}

test("a stale completed mutation leaves its durable receipt pending for reconciliation", async () => {
	const { manager, nextGeneration } = fixture();
	const reply = deferred<unknown>();
	manager.invoke = () => reply.promise;
	const db = new Database(":memory:");
	const intents = new OperationIntents(db as unknown as SqliteDatabase);
	const controller = new WorkstationController(manager, intents);
	const operationId = "0f9c00ca-67c8-4f1d-ac3e-ea7eebbf126c";
	const pending = controller.invoke({
		connectionId: "machine",
		generation: 1,
		path: "workspaces.createSession",
		type: "mutation",
		input: { operationId, name: "Remote session" },
	});
	nextGeneration();
	reply.resolve({ status: "completed", result: { workspaceId: "workspace" } });
	await expect(pending).rejects.toThrow("Connection changed");
	expect(intents.list("machine").map((row) => row.operationId)).toEqual([
		operationId,
	]);
	db.close();
});

test("a stale reconciliation reply cannot clear an intent on the new connection", async () => {
	const { manager, nextGeneration } = fixture();
	const reply = deferred<unknown>();
	manager.invoke = () => reply.promise;
	const db = new Database(":memory:");
	const intents = new OperationIntents(db as unknown as SqliteDatabase);
	intents.begin({
		connectionId: "machine",
		backendId: "backend",
		namespaceId: "namespace",
		operationId: "operation",
		procedure: "chat.prompt",
		inputHash: "digest",
	});
	const pending = new WorkstationController(manager, intents).reconcile(
		"machine",
	);
	nextGeneration();
	reply.resolve({ status: "completed" });
	await expect(pending).rejects.toThrow("Connection changed");
	expect(intents.list("machine")).toHaveLength(1);
	db.close();
});

test("attachment and file event readiness require explicit backend capabilities", async () => {
	const { manager } = fixture();
	for (const advertised of [true, false, undefined, "true"]) {
		manager.request = async () =>
			Response.json({
				capabilities: {
					attachments: advertised,
					workstationChatAttachmentInputV1: advertised,
					workstationFileEventsV1: advertised,
					workstationTerminalPresetsV1: advertised,
				},
			});
		const features = await new WorkstationController(manager).features(
			"machine",
		);
		expect(features.capabilities?.attachments).toBe(advertised === true);
		expect(features.capabilities?.workstationFileEventsV1).toBe(
			advertised === true,
		);
		expect(features.capabilities?.workstationChatAttachmentInputV1).toBe(
			advertised === true,
		);
		expect(features.capabilities?.workstationTerminalPresetsV1).toBe(
			advertised === true,
		);
	}
});

test("backend capabilities are checked after the response body finishes parsing", async () => {
	const { manager, nextGeneration } = fixture();
	const body = deferred<unknown>();
	const parsing = deferred<void>();
	const response = new Response();
	response.json = () => {
		parsing.resolve();
		return body.promise;
	};
	manager.request = async () => response;
	const pending = new WorkstationController(manager).features("machine");
	await parsing.promise;
	nextGeneration();
	body.resolve({ capabilities: { chat: true } });
	await expect(pending).rejects.toThrow("Connection changed");
});

test("chat replies parsed after reconnect cannot update the renderer", async () => {
	const { manager, nextGeneration } = fixture();
	const body = deferred<unknown>();
	const parsing = deferred<void>();
	const response = new Response();
	response.json = () => {
		parsing.resolve();
		return body.promise;
	};
	manager.request = async () => response;
	const pending = new WorkstationController(manager).invoke({
		connectionId: "machine",
		generation: 1,
		path: "chat.listSessions",
		type: "query",
	});
	await parsing.promise;
	nextGeneration();
	body.resolve({ result: { data: [{ id: "stale" }] } });
	await expect(pending).rejects.toThrow("Connection changed");
});

test("host replies completed after reconnect cannot update the renderer", async () => {
	const { manager, nextGeneration } = fixture();
	const reply = deferred<unknown>();
	manager.invoke = () => reply.promise;
	const pending = new WorkstationController(manager).invoke({
		connectionId: "machine",
		generation: 1,
		path: "project.list",
		type: "query",
	});
	nextGeneration();
	reply.resolve([{ id: "stale" }]);
	await expect(pending).rejects.toThrow("Connection changed");
});

test("malformed operation IDs fail before creating a durable local blocker", async () => {
	const { manager, calls } = fixture();
	const db = new Database(":memory:");
	const intents = new OperationIntents(db as unknown as SqliteDatabase);
	const controller = new WorkstationController(manager, intents);
	await expect(
		controller.invoke({
			connectionId: "machine",
			generation: 1,
			path: "project.create",
			type: "mutation",
			input: { operationId: "------------------------------------" },
		}),
	).rejects.toThrow("stable operation ID");
	expect(intents.list("machine")).toEqual([]);
	expect(calls).toEqual([]);
	db.close();
});

test("repository history needs its own optional capability and reaches only the explicit workspace", async () => {
	const f = fixture();
	const requests: unknown[] = [];
	const enabled = false;
	const controller = new WorkstationController({
		...f.manager,
		getVerifiedDescription: () => ({
			capabilities: {
				workstationGitV1: true,
				workstationGitHistoryV1: enabled,
			},
		}),
		invoke: async (id, request) => {
			requests.push({ id, ...request });
			return { commits: [], head: null, nextCursor: null };
		},
	});
	const request = {
		connectionId: "machine",
		generation: 1,
		path: "git.listRepositoryCommitsV1",
		type: "query" as const,
		input: { workspaceId: "workspace", limit: 50 },
	};
	await expect(controller.invoke(request)).rejects.toThrow(
		"required capability",
	);
	expect(requests).toEqual([]);
	const updated = new WorkstationController({
		...f.manager,
		getVerifiedDescription: () => ({
			capabilities: { workstationGitHistoryV1: true },
		}),
		invoke: async (id, request) => {
			requests.push({ id, ...request });
			return { commits: [], head: null, nextCursor: null };
		},
	});
	await updated.invoke(request);
	expect(requests).toHaveLength(1);
	expect(requests[0]).toMatchObject({
		id: "machine",
		path: "git.listRepositoryCommitsV1",
		input: { workspaceId: "workspace", limit: 50 },
	});
	await expect(
		updated.invoke({ ...request, input: { limit: 50 } }),
	).rejects.toThrow("explicit workspace");
	expect(requests).toHaveLength(1);
});

test("branch synchronization needs its optional capability and journals a lost reply", async () => {
	const f = fixture();
	const requests: unknown[] = [];
	let enabled = false;
	const db = new Database(":memory:");
	const intents = new OperationIntents(db as unknown as SqliteDatabase);
	const controller = new WorkstationController(
		{
			...f.manager,
			getVerifiedDescription: () => ({
				capabilities: {
					workstationGitV1: true,
					workstationGitSyncV1: enabled,
					durableOperations: true,
				},
			}),
			invoke: async (_id, request) => {
				requests.push(request);
				throw new Error("Reply lost");
			},
		},
		intents,
	);
	const request = {
		connectionId: "machine",
		generation: 1,
		path: "git.syncBranchV1",
		type: "mutation" as const,
		input: {
			workspaceId: "workspace",
			action: "sync",
			operationId: "1046dcad-c30b-4868-80e3-d61bf5ea64c8",
		},
	};
	try {
		await expect(controller.invoke(request)).rejects.toThrow(
			"required capability",
		);
		expect(requests).toEqual([]);
		enabled = true;
		await expect(controller.invoke(request)).rejects.toThrow("Reply lost");
		expect(requests).toEqual([
			{
				path: "direct.execute",
				type: "mutation",
				input: {
					operationId: request.input.operationId,
					procedure: "git.syncBranchV1",
					input: { workspaceId: "workspace", action: "sync" },
				},
			},
		]);
		expect(intents.list("machine")).toMatchObject([
			{ operationId: request.input.operationId, procedure: "git.syncBranchV1" },
		]);
		await expect(
			controller.invoke({
				...request,
				input: {
					...request.input,
					operationId: "b8e2eb57-173e-461a-84e9-ff8029795a27",
				},
			}),
		).rejects.toThrow("pending");
		expect(requests).toHaveLength(1);
	} finally {
		db.close();
	}
});

test("project script procedures require their own capability and an explicit project", async () => {
	const f = fixture();
	let capable = false;
	const requests: unknown[] = [];
	const controller = new WorkstationController({
		...f.manager,
		getVerifiedDescription: () => ({
			capabilities: { workstationProjectScriptsV1: capable },
		}),
		invoke: async (id, request) => {
			requests.push({ id, ...request });
			return { success: true };
		},
	});
	const request = {
		connectionId: "machine",
		generation: 1,
		path: "config.getProjectScriptsV1",
		type: "query" as const,
		input: { projectId: "project" },
	};
	await expect(controller.invoke(request)).rejects.toThrow(
		"required capability",
	);
	capable = true;
	await expect(controller.invoke({ ...request, input: {} })).rejects.toThrow(
		"explicit project",
	);
	await controller.invoke(request);
	await controller.invoke({
		...request,
		path: "config.setProjectScriptsV1",
		type: "mutation",
		input: {
			projectId: "project",
			expectedRevision: null,
			setup: [],
			teardown: [],
			run: [],
		},
	});
	expect(requests).toHaveLength(2);
});

test.each([
	"workspaceRun.startV1",
	"workspaceRun.startV2",
	"workspaceCleanup.destroyTrackedV1",
])("a lost %s response remains journaled and blocks a second operation", async (path) => {
	const db = new Database(":memory:"),
		intents = new OperationIntents(db as unknown as SqliteDatabase),
		f = fixture();
	const requests: unknown[] = [];
	const controller = new WorkstationController(
		{
			...f.manager,
			getVerifiedDescription: () => ({
				capabilities: {
					workstationWorkspaceRunV1: true,
					workstationWorkspaceRunV2: true,
					workstationWorkspaceCleanupV1: true,
					durableOperations: true,
				},
			}),
			invoke: async (_id, request) => {
				requests.push(request);
				throw new Error("Response lost");
			},
		},
		intents,
	);
	const request = {
		connectionId: "machine",
		generation: 1,
		path,
		type: "mutation" as const,
		input: {
			workspaceId: "workspace",
			operationId: crypto.randomUUID(),
			definitionVersion: "a".repeat(64),
		},
	};
	try {
		await expect(controller.invoke(request)).rejects.toThrow("Response lost");
		await expect(
			controller.invoke({
				...request,
				input: { ...request.input, operationId: crypto.randomUUID() },
			}),
		).rejects.toThrow("pending");
		expect(requests).toHaveLength(1);
		expect(intents.list("machine")).toMatchObject([
			{
				procedure: path,
				operationId: request.input.operationId,
			},
		]);
	} finally {
		db.close();
	}
});

test("setup status is read only with an explicit workspace and its advertised capability", async () => {
	const f = fixture();
	let capable = false;
	const requests: unknown[] = [];
	const controller = new WorkstationController({
		...f.manager,
		getVerifiedDescription: () => ({
			capabilities: { workstationWorkspaceSetupV1: capable },
		}),
		invoke: async (_id, r) => {
			requests.push(r);
			return null;
		},
	});
	const request = {
		connectionId: "machine",
		generation: 1,
		path: "workspaceSetup.getStateV1",
		type: "query" as const,
		input: { workspaceId: "workspace" },
	};
	await expect(controller.invoke(request)).rejects.toThrow(
		"required capability",
	);
	capable = true;
	await expect(
		controller.invoke({ ...request, input: { workspaceId: "" } }),
	).rejects.toThrow("explicit workspace");
	expect(await controller.invoke(request)).toBeNull();
	expect(requests).toEqual([request]);
});

test("only the advertised read-only terminal agent catalog is exposed to the workstation", async () => {
	const f = fixture();
	let enabled = false;
	const calls: unknown[] = [];
	const controller = new WorkstationController({
		...f.manager,
		getVerifiedDescription: () => ({
			capabilities: { workstationTerminalPresetsV1: enabled },
		}),
		invoke: async (id, request) => {
			calls.push({ id, ...request });
			return [{ id: "remote-config" }];
		},
	});
	const request = {
		connectionId: "machine",
		generation: 1,
		path: "settings.agentConfigs.list",
		type: "query" as const,
	};
	await expect(controller.invoke(request)).rejects.toThrow(
		"required capability",
	);
	expect(calls).toEqual([]);
	enabled = true;
	expect(await controller.invoke(request)).toEqual([{ id: "remote-config" }]);
	expect(calls).toEqual([{ id: "machine", ...request }]);
	await expect(
		controller.invoke({
			...request,
			path: "settings.agentConfigs.update",
			type: "mutation",
		}),
	).rejects.toThrow("Unsupported workstation procedure");
	expect(calls).toHaveLength(1);
});

test("versioned agent settings require a target id, capability and current connection", async () => {
	const f = fixture();
	let enabled = false;
	const calls: unknown[] = [];
	const controller = new WorkstationController({
		...f.manager,
		getVerifiedDescription: () => ({
			capabilities: { workstationAgentSettingsV1: enabled },
		}),
		invoke: async (id, request) => {
			calls.push({ id, ...request });
			return { revision: "a".repeat(64), config: { id: "agent" } };
		},
	});
	const request = {
		connectionId: "machine",
		generation: 1,
		path: "settings.agentConfigs.getWithRevisionV1",
		type: "query" as const,
		input: { id: "agent" },
	};
	await expect(controller.invoke(request)).rejects.toThrow(
		"required capability",
	);
	enabled = true;
	await expect(controller.invoke({ ...request, input: {} })).rejects.toThrow(
		"explicit agent",
	);
	await controller.invoke(request);
	await controller.invoke({
		...request,
		path: "settings.agentConfigs.updateWithRevisionV1",
		type: "mutation",
		input: {
			id: "agent",
			expectedRevision: "a".repeat(64),
			patch: { label: "New" },
		},
	});
	expect(calls).toHaveLength(2);
	f.nextGeneration();
	await expect(controller.invoke(request)).rejects.toThrow(
		"Connection changed",
	);
	expect(calls).toHaveLength(2);
});

test("versioned catalog management is gated separately from row editing and rejects stale connections", async () => {
	const f = fixture();
	let enabled = false;
	const calls: unknown[] = [];
	const controller = new WorkstationController({
		...f.manager,
		getVerifiedDescription: () => ({
			capabilities: {
				workstationAgentSettingsV1: true,
				workstationAgentManagementV1: enabled,
			},
		}),
		invoke: async (id, request) => {
			calls.push({ id, ...request });
			return { configs: [], revision: "a".repeat(64) };
		},
	});
	const request = {
		connectionId: "machine",
		generation: 1,
		path: "settings.agentConfigs.catalogWithRevisionV1",
		type: "query" as const,
	};
	await expect(controller.invoke(request)).rejects.toThrow(
		"required capability",
	);
	expect(calls).toHaveLength(0);
	enabled = true;
	await controller.invoke(request);
	await controller.invoke({
		...request,
		path: "settings.agentConfigs.applyCatalogChangeV1",
		type: "mutation",
		input: { expectedRevision: "a".repeat(64), change: { kind: "reset" } },
	});
	expect(calls).toHaveLength(2);
	f.nextGeneration();
	await expect(controller.invoke(request)).rejects.toThrow(
		"Connection changed",
	);
	expect(calls).toHaveLength(2);
});

test("preserved agent catalog choices require the V2 capability independently of V1 management", async () => {
	const f = fixture();
	let enabled = false;
	const calls: unknown[] = [];
	const controller = new WorkstationController({
		...f.manager,
		getVerifiedDescription: () => ({
			capabilities: {
				workstationAgentManagementV1: true,
				workstationAgentCatalogV2: enabled,
			},
		}),
		invoke: async (_id, r) => {
			calls.push(r);
			return { configs: [], revision: "a".repeat(64) };
		},
	});
	const request = {
		connectionId: "machine",
		generation: 1,
		path: "settings.agentConfigs.catalogWithRevisionV2",
		type: "query" as const,
	};
	await expect(controller.invoke(request)).rejects.toThrow(
		"required capability",
	);
	const mutation = {
		...request,
		path: "settings.agentConfigs.applyCatalogChangeV2",
		type: "mutation" as const,
		input: { expectedRevision: "a".repeat(64), change: { kind: "reset" } },
	};
	await expect(controller.invoke(mutation)).rejects.toThrow(
		"required capability",
	);
	expect(calls).toHaveLength(0);
	enabled = true;
	await controller.invoke(request);
	await controller.invoke(mutation);
	expect(calls).toHaveLength(2);
	f.nextGeneration();
	await expect(controller.invoke(request)).rejects.toThrow(
		"Connection changed",
	);
	expect(calls).toHaveLength(2);
});

test("terminal script storage requires its own strict capability and the current generation", async () => {
	const f = fixture();
	let enabled: unknown = false;
	const calls: unknown[] = [];
	const controller = new WorkstationController({
		...f.manager,
		getVerifiedDescription: () => ({
			capabilities: {
				workstationTerminalPresetsV1: true,
				workstationTerminalScriptsV1: enabled,
			},
		}),
		invoke: async (_id, request) => {
			calls.push(request);
			return { initialized: true, presets: [], revision: "a".repeat(64) };
		},
	});
	const read = {
		connectionId: "machine",
		generation: 1,
		path: "settings.terminalPresets.catalogWithRevisionV1",
		type: "query" as const,
	};
	const write = {
		...read,
		path: "settings.terminalPresets.applyCatalogChangeV1",
		type: "mutation" as const,
		input: {
			expectedRevision: "a".repeat(64),
			change: { kind: "initialize", presets: [] },
		},
	};
	for (const value of [undefined, false, "true", 1]) {
		enabled = value;
		await expect(controller.invoke(read)).rejects.toThrow(
			"required capability",
		);
		await expect(controller.invoke(write)).rejects.toThrow(
			"required capability",
		);
	}
	expect(calls).toHaveLength(0);
	enabled = true;
	await controller.invoke(read);
	await controller.invoke(write);
	expect(calls).toHaveLength(2);
	f.nextGeneration();
	await expect(controller.invoke(write)).rejects.toThrow("Connection changed");
	expect(calls).toHaveLength(2);
});

test("existing-terminal scripts require a strict execution capability and durable operation tracking", async () => {
	const f = fixture(),
		db = new Database(":memory:"),
		intents = new OperationIntents(db as unknown as SqliteDatabase);
	let enabled: unknown = false;
	const calls: unknown[] = [];
	const manager = {
		...f.manager,
		getVerifiedDescription: () => ({
			capabilities: {
				durableOperations: true,
				workstationTerminalScriptExecutionV1: enabled,
			},
		}),
		invoke: async (_id: string, request: unknown) => {
			calls.push(request);
			return { status: "completed", result: { submitted: true } };
		},
	};
	const controller = new WorkstationController(manager, intents),
		request = {
			connectionId: "machine",
			generation: 1,
			path: "terminal.runScriptV1",
			type: "mutation" as const,
			input: {
				workspaceId: "workspace",
				terminalId: "terminal",
				executionId: "execution",
				text: "printf once",
				operationId: crypto.randomUUID(),
			},
		};
	try {
		for (const value of [undefined, false, "true", 1]) {
			enabled = value;
			await expect(controller.invoke(request)).rejects.toThrow(
				"required capability",
			);
		}
		expect(calls).toEqual([]);
		enabled = true;
		await expect(
			new WorkstationController(manager).invoke(request),
		).rejects.toThrow("tracking");
		await controller.invoke(request);
		expect(calls).toHaveLength(1);
		expect(calls[0]).toMatchObject({
			path: "direct.execute",
			input: {
				procedure: "terminal.runScriptV1",
				operationId: request.input.operationId,
				input: { executionId: "execution", text: "printf once" },
			},
		});
		f.nextGeneration();
		await expect(controller.invoke(request)).rejects.toThrow(
			"Connection changed",
		);
		expect(calls).toHaveLength(1);
	} finally {
		db.close();
	}
});

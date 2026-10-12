import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import type { SqliteDatabase } from "@superset/direct-connection";
import { OperationIntents } from "./operation-intents";
import { WorkstationController } from "./workstation-controller";

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

test("attachment readiness requires an explicit backend capability", async () => {
	const { manager } = fixture();
	for (const advertised of [true, false, undefined]) {
		manager.request = async () =>
			Response.json({ capabilities: { attachments: advertised } });
		const features = await new WorkstationController(manager).features(
			"machine",
		);
		expect(features.capabilities?.attachments).toBe(advertised === true);
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

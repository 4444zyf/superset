import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { request } from "node:http";
import { after, before, test } from "node:test";
import { serve, type ServerType } from "@hono/node-server";
import { createNodeWebSocket } from "@hono/node-ws";
import {
	encodeBrowserBridgePacket,
	parseBrowserBridgePacket,
	browserCapturePackets,
	type BrowserBridgePacket,
} from "@superset/shared/browser-bridge";
import { Hono } from "hono";
import { PskHostAuthProvider } from "../providers/host-auth/PskHostAuthProvider/PskHostAuthProvider.ts";
import { DirectBrowserReadBridge } from "./browser-read-bridge.ts";
import { registerDirectBrowserReadRoute } from "./browser-read-route.ts";

const identity = {
	backendId: "owned-backend",
	namespaceId: "owned-namespace",
	instanceId: "owned-instance",
};
const secret = "owned-read-route-fixture-key";
const bridge = new DirectBrowserReadBridge(identity);
const clients = new Set<WebSocket>();
let server: ServerType;
let port = 0;

before(async () => {
	const app = new Hono(),
		auth = new PskHostAuthProvider(secret);
	app.use("/direct/*", async (context, next) => {
		const token = context.req.query("token");
		if (
			!(await auth.validate(context.req.raw)) &&
			!(token && (await auth.validateToken(token)))
		)
			return context.json({ error: "Unauthorized" }, 401);
		return next();
	});
	const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app });
	registerDirectBrowserReadRoute({ app, upgradeWebSocket, bridge });
	port = await new Promise<number>((resolve) => {
		server = serve(
			{ fetch: app.fetch, hostname: "127.0.0.1", port: 0 },
			(info) => resolve(info.port),
		);
	});
	injectWebSocket(server);
});

after(async () => {
	bridge.dispose();
	for (const client of clients) {
		if (client.readyState === WebSocket.CLOSED) continue;
		const closed = new Promise<void>((resolve) =>
			client.addEventListener("close", () => resolve(), { once: true }),
		);
		client.close();
		await closed;
	}
	await new Promise<void>((resolve) => server.close(() => resolve()));
});

test(
	"an unauthenticated WebSocket upgrade cannot reserve the browser peer",
	{ timeout: 5000 },
	async () => {
		const status = await new Promise<number>((resolve, reject) => {
			const outgoing = request(
				{
					hostname: "127.0.0.1",
					port,
					path: "/direct/browser-read/v1",
					headers: {
						Connection: "Upgrade",
						Upgrade: "websocket",
						"Sec-WebSocket-Version": "13",
						"Sec-WebSocket-Key": randomBytes(16).toString("base64"),
					},
				},
				(response) => {
					response.resume();
					resolve(response.statusCode ?? 0);
				},
			);
			outgoing.on("upgrade", (_response, socket) => {
				socket.destroy();
				resolve(101);
			});
			outgoing.on("error", reject);
			outgoing.end();
		});
		assert.equal(status, 401);
		assert.equal(bridge.isReady(), false);
	},
);

test(
	"negotiated screenshots cross real WebSocket frames beyond one original frame budget",
	{ timeout: 5000 },
	async () => {
		const socket = new WebSocket(
			`ws://127.0.0.1:${port}/direct/browser-read/v1?token=${secret}`,
		);
		clients.add(socket);
		const ready = Promise.withResolvers<void>();
		const base64 = Buffer.concat([
			Buffer.from("89504e470d0a1a0a", "hex"),
			Buffer.alloc(4 * 1024 * 1024, 42),
		]).toString("base64");
		socket.addEventListener("open", () =>
			socket.send(
				encodeBrowserBridgePacket({
					type: "hello",
					protocol: 1,
					...identity,
					features: ["readV1", "capturePngV1"],
				}),
			),
		);
		socket.addEventListener("error", () =>
			ready.reject(Error("Owned screenshot socket failed")),
		);
		socket.addEventListener("message", (event) => {
			const packet = parseBrowserBridgePacket(String(event.data));
			if (packet.type === "ready") {
				ready.resolve();
				return;
			}
			if (packet.type === "capture-request")
				for (const part of browserCapturePackets(packet.id, base64))
					socket.send(encodeBrowserBridgePacket(part));
		});
		try {
			await ready.promise;
			assert.equal(bridge.isCaptureReady(), true);
			assert.deepEqual(
				await bridge.capturePng("owned-workspace", "owned-pane"),
				{ base64 },
			);
		} finally {
			const closed = new Promise<void>((resolve) =>
				socket.addEventListener("close", () => resolve(), { once: true }),
			);
			socket.close();
			await closed;
		}
	},
);

test(
	"negotiated navigation crosses the authenticated socket only after its pin executes",
	{ timeout: 5000 },
	async () => {
		const socket = new WebSocket(
			`ws://127.0.0.1:${port}/direct/browser-read/v1?token=${secret}`,
		);
		clients.add(socket);
		const ready = Promise.withResolvers<void>();
		const requests: Extract<
			BrowserBridgePacket,
			{ type: "navigate-request" }
		>[] = [];
		socket.addEventListener("open", () =>
			socket.send(
				encodeBrowserBridgePacket({
					type: "hello",
					protocol: 1,
					...identity,
					features: ["readV1", "navigateV1"],
				}),
			),
		);
		socket.addEventListener("error", () =>
			ready.reject(Error("Owned navigation socket failed")),
		);
		socket.addEventListener("message", (event) => {
			const packet = parseBrowserBridgePacket(String(event.data));
			if (packet.type === "ready") {
				ready.resolve();
				return;
			}
			if (packet.type === "navigate-request") {
				requests.push(packet);
				socket.send(
					encodeBrowserBridgePacket({
						type: "navigate-result",
						id: packet.id,
						ok: true,
					}),
				);
			}
		});
		try {
			await ready.promise;
			const input = {
				workspaceId: "owned-workspace",
				paneId: "owned-pane",
				url: "http://localhost:3000/中文",
			};
			const pinned = bridge.pinNavigation(input);
			assert.equal(requests.length, 0);
			assert.deepEqual(await pinned(), { ok: true });
			assert.equal(requests.length, 1);
			assert.deepEqual(
				{ ...requests[0]!, id: "request" },
				{ type: "navigate-request", id: "request", ...input },
			);
			pinned.release?.();
		} finally {
			const closed = new Promise<void>((resolve) =>
				socket.addEventListener("close", () => resolve(), { once: true }),
			);
			socket.close();
			await closed;
		}
	},
);
test(
	"negotiated open crosses the authenticated socket only after its pin executes",
	{ timeout: 5000 },
	async () => {
		const socket = new WebSocket(
			`ws://127.0.0.1:${port}/direct/browser-read/v1?token=${secret}`,
		);
		clients.add(socket);
		const ready = Promise.withResolvers<void>();
		const scopeId = randomUUID();
		const requests: Extract<BrowserBridgePacket, { type: "open-request" }>[] =
			[];
		socket.addEventListener("open", () =>
			socket.send(
				encodeBrowserBridgePacket({
					type: "hello",
					protocol: 1,
					...identity,
					features: ["readV1", "openV1"],
				}),
			),
		);
		socket.addEventListener("error", () =>
			ready.reject(Error("Owned open socket failed")),
		);
		socket.addEventListener("message", (event) => {
			const packet = parseBrowserBridgePacket(String(event.data));
			if (packet.type === "ready") {
				socket.send(
					encodeBrowserBridgePacket({
						type: "open-availability",
						scopeId,
						ready: true,
						accepting: true,
					}),
				);
				ready.resolve();
				return;
			}
			if (packet.type === "request") {
				socket.send(
					encodeBrowserBridgePacket({
						type: "result",
						id: packet.id,
						ok: true,
						value: { panes: [] },
					}),
				);
				return;
			}
			if (packet.type === "open-request") {
				requests.push(packet);
				socket.send(
					encodeBrowserBridgePacket({
						type: "open-result",
						id: packet.id,
						scopeId: packet.scopeId,
						ok: true,
						result: {
							paneId: "created-pane",
							url: "http://localhost:3000/中文",
							title: "",
						},
					}),
				);
			}
		});
		try {
			await ready.promise;
			assert.deepEqual(await bridge.listPanes("owned-workspace"), {
				panes: [],
			});
			const input = {
				workspaceId: "owned-workspace",
				projectId: null,
				workspaceName: "Owned",
				target: "current-tab" as const,
				show: false,
				url: "http://localhost:3000/中文",
			};
			const pinned = bridge.pinOpen(input);
			assert.equal(requests.length, 0);
			assert.deepEqual(await pinned(), {
				paneId: "created-pane",
				url: "http://localhost:3000/中文",
				title: "",
			});
			assert.equal(requests.length, 1);
			assert.deepEqual(
				{ ...requests[0]!, id: "request" },
				{ type: "open-request", id: "request", scopeId, ...input },
			);
			pinned.release?.();
		} finally {
			const closed = new Promise<void>((resolve) =>
				socket.addEventListener("close", () => resolve(), { once: true }),
			);
			socket.close();
			await closed;
		}
	},
);
test(
	"negotiated evaluation crosses the authenticated socket only after its pin executes",
	{ timeout: 5000 },
	async () => {
		const socket = new WebSocket(
			`ws://127.0.0.1:${port}/direct/browser-read/v1?token=${secret}`,
		);
		clients.add(socket);
		const ready = Promise.withResolvers<void>();
		const requests: Extract<
			BrowserBridgePacket,
			{ type: "evaluate-request" }
		>[] = [];
		socket.addEventListener("open", () =>
			socket.send(
				encodeBrowserBridgePacket({
					type: "hello",
					protocol: 1,
					...identity,
					features: ["readV1", "evaluateV1"],
				}),
			),
		);
		socket.addEventListener("error", () =>
			ready.reject(Error("Owned evaluation socket failed")),
		);
		socket.addEventListener("message", (event) => {
			const packet = parseBrowserBridgePacket(String(event.data));
			if (packet.type === "ready") {
				ready.resolve();
				return;
			}
			if (packet.type === "evaluate-request") {
				requests.push(packet);
				socket.send(
					encodeBrowserBridgePacket({
						type: "evaluate-result",
						id: packet.id,
						ok: true,
						result: false,
					}),
				);
			}
		});
		try {
			await ready.promise;
			const input = {
				workspaceId: "owned-workspace",
				paneId: "owned-pane",
				code: "document.title",
			};
			const pinned = bridge.pinEvaluation(input);
			assert.equal(requests.length, 0);
			assert.deepEqual(await pinned(), { result: false });
			assert.equal(requests.length, 1);
			assert.deepEqual(
				{ ...requests[0]!, id: "request" },
				{ type: "evaluate-request", id: "request", ...input },
			);
			pinned.release?.();
		} finally {
			const closed = new Promise<void>((resolve) =>
				socket.addEventListener("close", () => resolve(), { once: true }),
			);
			socket.close();
			await closed;
		}
	},
);

test(
	"the authenticated read channel exchanges real frames and disconnect rejects a pending read",
	{ timeout: 5000 },
	async () => {
		const socket = new WebSocket(
			`ws://127.0.0.1:${port}/direct/browser-read/v1?token=${secret}`,
		);
		clients.add(socket);
		const ready = Promise.withResolvers<void>(),
			held = Promise.withResolvers<void>();
		void held.promise.catch(() => {});
		let hold = false;
		const operations: unknown[] = [];
		socket.addEventListener("error", () => {
			const error = Error("Owned WebSocket failed");
			ready.reject(error);
			held.reject(error);
		});
		socket.addEventListener("close", () => {
			const error = Error("Owned WebSocket closed");
			ready.reject(error);
			held.reject(error);
		});
		socket.addEventListener("open", () =>
			socket.send(
				encodeBrowserBridgePacket({
					type: "hello",
					protocol: 1,
					...identity,
					features: ["readV1"],
				}),
			),
		);
		socket.addEventListener("message", (event) => {
			const packet = parseBrowserBridgePacket(String(event.data));
			if (packet.type === "ready") {
				ready.resolve();
				return;
			}
			if (packet.type !== "request") return;
			operations.push(packet.operation);
			if (hold) {
				held.resolve();
				return;
			}
			const value =
				packet.operation.type === "list"
					? {
							panes: [
								{
									paneId: "owned-pane",
									workspaceId: packet.operation.workspaceId,
									url: "http://localhost/owned",
									title: "Owned page",
									isLoading: false,
								},
							],
						}
					: {
							entries: [
								{ level: "info", message: "Owned console", timestamp: 1 },
							],
						};
			socket.send(
				encodeBrowserBridgePacket({
					type: "result",
					id: packet.id,
					ok: true,
					value,
				}),
			);
		});
		try {
			await ready.promise;
			assert.equal(bridge.isReady(), true);
			assert.deepEqual(await bridge.listPanes("owned-workspace"), {
				panes: [
					{
						paneId: "owned-pane",
						workspaceId: "owned-workspace",
						url: "http://localhost/owned",
						title: "Owned page",
						isLoading: false,
					},
				],
			});
			assert.deepEqual(await bridge.console("owned-workspace", "owned-pane"), {
				entries: [{ level: "info", message: "Owned console", timestamp: 1 }],
			});
			hold = true;
			const pending = bridge
				.listPanes("owned-workspace")
				.catch((error) => error);
			await held.promise;
			socket.close();
			const error = await pending;
			assert.equal(error.kind, "unavailable");
			assert.equal(bridge.isReady(), false);
			assert.deepEqual(operations, [
				{ type: "list", workspaceId: "owned-workspace" },
				{
					type: "console",
					workspaceId: "owned-workspace",
					paneId: "owned-pane",
				},
				{ type: "list", workspaceId: "owned-workspace" },
			]);
		} finally {
			socket.close();
		}
	},
);

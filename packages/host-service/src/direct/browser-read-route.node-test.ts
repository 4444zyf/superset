import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { request } from "node:http";
import { after, before, test } from "node:test";
import { serve, type ServerType } from "@hono/node-server";
import { createNodeWebSocket } from "@hono/node-ws";
import {
	encodeBrowserBridgePacket,
	parseBrowserBridgePacket,
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

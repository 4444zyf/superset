import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { serve } from "@hono/node-server";
import { createNodeWebSocket } from "@hono/node-ws";
import type { DetectedPort } from "@superset/port-scanner";
import { directBackendSocketPath } from "@superset/shared/direct-backend-socket";
import { MUX_INITIAL_WINDOW_BYTES } from "@superset/shared/port-forward-mux";
import { Hono } from "hono";
import { DirectConnectionManager } from "../../../direct-connection/src/manager.ts";
import { DirectPortForwardManager } from "../../../direct-connection/src/port-forward.ts";
import { ConnectionRegistry } from "../../../direct-connection/src/registry.ts";
import { PskHostAuthProvider } from "../providers/host-auth/PskHostAuthProvider/PskHostAuthProvider.ts";
import { registerForwardMuxRoute } from "./forward-mux-route.ts";

const SECRET = "be".repeat(32);
const WORKSPACE_ID = "remote-workspace";

async function listen(app: Hono, injectWebSocket: (server: Server) => void) {
	let server!: Server;
	const port = await new Promise<number>((resolve) => {
		server = serve(
			{ fetch: app.fetch, hostname: "127.0.0.1", port: 0 },
			(info) => resolve(info.port),
		) as Server;
	});
	injectWebSocket(server);
	return { server, port };
}

async function fixture() {
	const body = Buffer.alloc(MUX_INITIAL_WINDOW_BYTES * 2 + 17, 0x61);
	const devApp = new Hono();
	const devWs = createNodeWebSocket({ app: devApp });
	devApp.get("/preview", (c) => c.body(body));
	devApp.get(
		"/socket",
		devWs.upgradeWebSocket(() => ({
			onMessage: (event, ws) => ws.send(`remote:${event.data}`),
		})),
	);
	const dev = await listen(devApp, devWs.injectWebSocket);
	const backendApp = new Hono();
	const backendWs = createNodeWebSocket({ app: backendApp });
	const auth = new PskHostAuthProvider(SECRET);
	backendApp.use("*", async (c, next) => {
		const token = c.req.query("token");
		if (!auth.validate(c.req.raw) && !(token && auth.validateToken(token))) {
			return c.json({ error: "Unauthorized" }, 401);
		}
		return next();
	});
	let backendPort = 0;
	const descriptor = {
		backendId: randomUUID(),
		namespaceId: randomUUID(),
		instanceId: randomUUID(),
		serviceUid: 501,
		runtimeMode: "direct",
		protocolVersion: 1,
		socketPath: "",
	};
	descriptor.socketPath = directBackendSocketPath({
		homeDir: "/Users/alice/.superset-direct",
		...descriptor,
		uid: descriptor.serviceUid,
	});
	backendApp.get("/direct/describe", (c) =>
		c.json({ ...descriptor, port: backendPort }),
	);
	registerForwardMuxRoute({
		app: backendApp,
		upgradeWebSocket: backendWs.upgradeWebSocket,
		getPortsByWorkspace: (workspaceId): DetectedPort[] =>
			workspaceId === WORKSPACE_ID
				? [
						{
							port: dev.port,
							pid: process.pid,
							processName: "dev-server",
							terminalId: "remote-terminal",
							workspaceId,
							detectedAt: 0,
							address: "127.0.0.1",
						},
					]
				: [],
	});
	const backend = await listen(backendApp, backendWs.injectWebSocket);
	backendPort = backend.port;
	const registry = new ConnectionRegistry(new DatabaseSync(":memory:"));
	registry.save({ id: "mini", name: "Mac mini", host: "test-mini" });
	const connections = new DirectConnectionManager({
		registry,
		healthAttempts: 1,
		runtime: {
			exec: async (_profile, command) => ({
				exitCode: 0,
				stderr: "",
				stdout: command.includes("uname")
					? ["Darwin", "arm64", "501", "alice", "/Users/alice", ""].join("\0")
					: `${JSON.stringify({ ...descriptor, port: backendPort })}\n${SECRET}`,
			}),
			upload: async () => {},
			forward: async () => ({
				url: `http://127.0.0.1:${backendPort}`,
				close: () => {},
			}),
		},
	});
	const forwards = new DirectPortForwardManager(connections);
	return {
		body,
		dev,
		backend,
		connections,
		forwards,
		close: async () => {
			forwards.dispose();
			connections.dispose();
			registry.close();
			for (const ws of [devWs, backendWs]) {
				for (const socket of ws.wss.clients) socket.terminate();
				ws.wss.close();
			}
			for (const { server } of [dev, backend]) server.closeAllConnections();
			await Promise.all(
				[dev.server, backend.server].map(
					(server) =>
						new Promise<void>((resolve) => server.close(() => resolve())),
				),
			);
		},
	};
}

function event(target: WebSocket, type: string): Promise<Event> {
	return new Promise((resolve, reject) => {
		const cleanup = () => {
			clearTimeout(timer);
			target.removeEventListener(type, received);
			target.removeEventListener("error", failed);
		};
		const received = (event: Event) => {
			cleanup();
			resolve(event);
		};
		const failed = () => {
			cleanup();
			reject(new Error("WebSocket test failed"));
		};
		const timer = setTimeout(() => {
			cleanup();
			reject(new Error("WebSocket test event missing"));
		}, 1000);
		timer.unref();
		target.addEventListener(type, received, { once: true });
		if (type !== "close")
			target.addEventListener("error", failed, { once: true });
	});
}

test(
	"authenticated direct mux preserves finite HTTP bodies and leaves the remote server running after disconnect",
	{ timeout: 2000 },
	async (t) => {
		const f = await fixture();
		t.after(f.close);
		assert.equal(
			(
				await fetch(
					`http://127.0.0.1:${f.backend.port}/fwd?workspaceId=${WORKSPACE_ID}`,
				)
			).status,
			401,
		);
		await f.connections.connect("mini");
		const forward = await f.forwards.open("mini", WORKSPACE_ID, f.dev.port);
		const response = await fetch(`${forward.url}/preview`, {
			signal: AbortSignal.timeout(1000),
		});
		assert.deepEqual(Buffer.from(await response.arrayBuffer()), f.body);
		assert.equal(JSON.stringify(forward).includes(SECRET), false);
		f.forwards.closeConnection("mini");
		f.connections.disconnect("mini");
		await assert.rejects(fetch(`${forward.url}/preview`));
		assert.equal(
			(await fetch(`http://127.0.0.1:${f.dev.port}/preview`)).status,
			200,
		);
	},
);

test(
	"browser WebSocket upgrades and bidirectional messages cross the direct mux without a renderer credential",
	{ timeout: 2000 },
	async (t) => {
		const f = await fixture();
		t.after(f.close);
		await f.connections.connect("mini");
		await assert.rejects(
			f.forwards.open("mini", "other-workspace", f.dev.port),
			/owned/,
		);
		const forward = await f.forwards.open("mini", WORKSPACE_ID, f.dev.port);
		const ws = new WebSocket(`${forward.url.replace("http:", "ws:")}/socket`);
		t.after(() => ws.close());
		await event(ws, "open");
		const reply = event(ws, "message");
		ws.send("preview");
		assert.equal(((await reply) as MessageEvent).data, "remote:preview");
		const closed = event(ws, "close");
		f.forwards.close(forward.id);
		await closed;
		assert.equal(
			(await fetch(`http://127.0.0.1:${f.dev.port}/preview`)).status,
			200,
		);
	},
);

import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { request } from "node:http";
import { test } from "node:test";
import { serve } from "@hono/node-server";
import { createNodeWebSocket } from "@hono/node-ws";
import {
	encodeBrowserBridgePacket,
	parseBrowserBridgePacket,
} from "@superset/shared/browser-bridge";
import {
	encodeBrowserCdpPacket,
	parseBrowserCdpPacket,
} from "@superset/shared/browser-cdp-bridge";
import {
	BROWSER_CDP_TOKEN_TTL_MS,
	mintBrowserCdpToken,
} from "@superset/shared/browser-cdp-token";
import { Hono } from "hono";
import { PskHostAuthProvider } from "../providers/host-auth/PskHostAuthProvider/PskHostAuthProvider.ts";
import { authorizeDirectBrowserCdpUpgrade } from "./browser-cdp-auth.ts";
import { registerDirectBrowserCdpRoute } from "./browser-cdp-route.ts";
import { DirectBrowserReadBridge } from "./browser-read-bridge.ts";
import { registerDirectBrowserReadRoute } from "./browser-read-route.ts";

const identity = {
	backendId: "owned-backend",
	namespaceId: "owned-namespace",
	instanceId: "owned-instance",
};
const secret = "owned-cdp-key";
async function fixture() {
	const app = new Hono(),
		auth = new PskHostAuthProvider(secret),
		bridge = new DirectBrowserReadBridge(identity);
	app.use("/direct/*", async (context, next) => {
		const token = context.req.query("token");
		if (
			!(await auth.validate(context.req.raw)) &&
			!(token && (await auth.validateToken(token))) &&
			!(await authorizeDirectBrowserCdpUpgrade(context.req.raw, identity, auth))
		)
			return context.json({ error: "Unauthorized" }, 401);
		return next();
	});
	const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app });
	registerDirectBrowserReadRoute({ app, upgradeWebSocket, bridge });
	registerDirectBrowserCdpRoute({ app, upgradeWebSocket, bridge });
	const listening = Promise.withResolvers<number>();
	const server = serve(
		{ fetch: app.fetch, hostname: "127.0.0.1", port: 0 },
		(info) => listening.resolve(info.port),
	);
	const port = await listening.promise;
	injectWebSocket(server);
	const clients: Array<{ socket: WebSocket; closed: Promise<CloseEvent> }> = [];
	async function dial(path: string, endpointToken = secret) {
		const socket = new WebSocket(
				`ws://127.0.0.1:${port}${path}${path.includes("?") ? "&" : "?"}token=${encodeURIComponent(endpointToken)}`,
			),
			queue: string[] = [],
			waiting: Array<(raw: string) => void> = [];
		const closed = new Promise<CloseEvent>((resolve) =>
			socket.addEventListener("close", resolve, { once: true }),
		);
		clients.push({ socket, closed });
		socket.addEventListener("message", (event) => {
			const raw = String(event.data),
				resolve = waiting.shift();
			if (resolve) resolve(raw);
			else queue.push(raw);
		});
		await new Promise<void>((resolve, reject) => {
			socket.addEventListener("open", () => resolve(), { once: true });
			socket.addEventListener(
				"error",
				() => reject(Error("Owned websocket failed")),
				{ once: true },
			);
		});
		return {
			socket,
			closed,
			queue,
			next: () => {
				const raw = queue.shift();
				return raw === undefined
					? new Promise<string>((resolve) => waiting.push(resolve))
					: Promise.resolve(raw);
			},
		};
	}
	async function peer(features = ["readV1", "cdpV1"]) {
		const p = await dial("/direct/browser-read/v1");
		p.socket.send(
			encodeBrowserBridgePacket({
				type: "hello",
				protocol: 1,
				...identity,
				features,
			}),
		);
		assert.equal(parseBrowserBridgePacket(await p.next()).type, "ready");
		return p;
	}
	return {
		port,
		bridge,
		dial,
		peer,
		async close() {
			bridge.dispose();
			for (const c of clients) {
				if (c.socket.readyState !== WebSocket.CLOSED) c.socket.close();
				await c.closed;
			}
			await new Promise<void>((resolve) => server.close(() => resolve()));
		},
	};
}

test(
	"unauthenticated raw CDP upgrades cannot allocate a client",
	{ timeout: 5000 },
	async () => {
		const f = await fixture();
		try {
			const status = await new Promise<number>((resolve, reject) => {
				const req = request(
					{
						hostname: "127.0.0.1",
						port: f.port,
						path: "/direct/browser/pane/cdp-v1?workspaceId=workspace",
						headers: {
							Connection: "Upgrade",
							Upgrade: "websocket",
							"Sec-WebSocket-Version": "13",
							"Sec-WebSocket-Key": randomBytes(16).toString("base64"),
						},
					},
					(res) => {
						res.resume();
						resolve(res.statusCode ?? 0);
					},
				);
				req.once("error", reject);
				req.end();
			});
			assert.equal(status, 401);
			assert.equal(f.bridge.isReady(), false);
		} finally {
			await f.close();
		}
	},
);

test(
	"real protected sockets carry queued text, UTF-8 binary commands and untouched responses",
	{ timeout: 5000 },
	async () => {
		const f = await fixture();
		try {
			const p = await f.peer(),
				c = await f.dial("/direct/browser/pane/cdp-v1?workspaceId=workspace"),
				open = parseBrowserCdpPacket(await p.next());
			assert.equal(open.type, "cdp-open");
			assert.equal(open.type === "cdp-open" && open.workspaceId, "workspace");
			const raw = ' {"id":1,"method":"Target.getTargets"} ';
			c.socket.send(raw);
			p.socket.send(
				encodeBrowserCdpPacket({
					type: "cdp-open-result",
					sessionId: open.sessionId,
					ok: true,
				}),
			);
			assert.deepEqual(parseBrowserCdpPacket(await p.next()), {
				type: "cdp-input",
				sessionId: open.sessionId,
				raw,
			});
			const answer = '{"id":1,"result":{"中文":"🙂"}}';
			p.socket.send(
				encodeBrowserCdpPacket({
					type: "cdp-output",
					sessionId: open.sessionId,
					raw: answer,
				}),
			);
			assert.equal(await c.next(), answer);
			const largeAnswer = `{"id":9,"result":{"data":"${"x".repeat(4 * 1024 * 1024)}"}}`;
			p.socket.send(
				encodeBrowserCdpPacket({
					type: "cdp-output",
					sessionId: open.sessionId,
					raw: largeAnswer,
				}),
			);
			assert.equal((await c.next()) === largeAnswer, true);
			const binary =
				'{"id":2,"method":"Runtime.evaluate","params":{"expression":"中文🙂"}}';
			c.socket.send(new TextEncoder().encode(binary));
			assert.deepEqual(parseBrowserCdpPacket(await p.next()), {
				type: "cdp-input",
				sessionId: open.sessionId,
				raw: binary,
			});
			const listing = f.bridge.listPanes("workspace"),
				read = parseBrowserBridgePacket(await p.next());
			assert.equal(read.type, "request");
			if (read.type !== "request") throw Error("No original read request");
			p.socket.send(
				encodeBrowserBridgePacket({
					type: "result",
					id: read.id,
					ok: true,
					value: { panes: [] },
				}),
			);
			assert.deepEqual(await listing, { panes: [] });
			c.socket.close(1000);
			assert.equal(parseBrowserCdpPacket(await p.next()).type, "cdp-close");
			assert.equal((await c.closed).code, 1000);
		} finally {
			await f.close();
		}
	},
);

test(
	"an old desktop peer cannot enable a raw CDP client",
	{ timeout: 5000 },
	async () => {
		const f = await fixture();
		try {
			const p = await f.peer(["readV1"]),
				c = await f.dial("/direct/browser/pane/cdp-v1?workspaceId=workspace");
			assert.equal((await c.closed).code, 1011);
			assert.equal(f.bridge.isReady(), true);
			assert.equal(p.queue.length, 0);
		} finally {
			await f.close();
		}
	},
);

test(
	"original busy and invalid-scope results close only the requested raw CDP socket",
	{ timeout: 5000 },
	async () => {
		const f = await fixture();
		try {
			const p = await f.peer();
			for (const code of [1013, 1011] as const) {
				const c = await f.dial(
						`/direct/browser/pane/cdp-v1?workspaceId=${code === 1011 ? "foreign" : "workspace"}`,
					),
					open = parseBrowserCdpPacket(await p.next());
				assert.equal(open.type, "cdp-open");
				p.socket.send(
					encodeBrowserCdpPacket({
						type: "cdp-open-result",
						sessionId: open.sessionId,
						ok: false,
						code,
					}),
				);
				assert.equal((await c.closed).code, code);
				assert.equal(f.bridge.isCdpReady(), true);
			}
		} finally {
			await f.close();
		}
	},
);

test(
	"retiring the actual peer closes its raw CDP client",
	{ timeout: 5000 },
	async () => {
		const f = await fixture();
		try {
			const p = await f.peer(),
				c = await f.dial("/direct/browser/pane/cdp-v1?workspaceId=workspace"),
				open = parseBrowserCdpPacket(await p.next());
			p.socket.send(
				encodeBrowserCdpPacket({
					type: "cdp-open-result",
					sessionId: open.sessionId,
					ok: true,
				}),
			);
			p.socket.close();
			assert.equal((await c.closed).code, 1011);
			assert.equal(f.bridge.isCdpReady(), false);
		} finally {
			await f.close();
		}
	},
);

test(
	"oversized binary commands close with the original input-size code and release Main",
	{ timeout: 5000 },
	async () => {
		const f = await fixture();
		try {
			const p = await f.peer(),
				c = await f.dial("/direct/browser/pane/cdp-v1?workspaceId=workspace"),
				open = parseBrowserCdpPacket(await p.next());
			assert.equal(open.type, "cdp-open");
			c.socket.send(new Uint8Array(4 * 1024 * 1024 + 1));
			assert.equal((await c.closed).code, 1009);
			assert.equal(parseBrowserCdpPacket(await p.next()).type, "cdp-close");
			assert.equal(f.bridge.isCdpReady(), true);
		} finally {
			await f.close();
		}
	},
);

test(
	"an instance-bound CDP URL cannot bind to a restarted backend",
	{ timeout: 5000 },
	async () => {
		const f = await fixture();
		try {
			const p = await f.peer(),
				c = await f.dial(
					"/direct/browser/pane/cdp-v1?workspaceId=workspace&instanceId=stale",
				);
			assert.equal((await c.closed).code, 1011);
			assert.equal(p.queue.length, 0);
			assert.equal(f.bridge.isCdpReady(), true);
		} finally {
			await f.close();
		}
	},
);

test(
	"real CDP upgrades accept target-scoped credentials without exposing the namespace PSK",
	{ timeout: 5000 },
	async () => {
		const f = await fixture();
		try {
			const p = await f.peer(),
				scope = { ...identity, workspaceId: "workspace", paneId: "pane" },
				token = mintBrowserCdpToken(secret, scope);
			assert.notEqual(token, secret);
			const c = await f.dial(
					`/direct/browser/pane/cdp-v1?workspaceId=workspace&instanceId=${identity.instanceId}`,
					token,
				),
				open = parseBrowserCdpPacket(await p.next());
			assert.equal(open.type, "cdp-open");
			p.socket.send(
				encodeBrowserCdpPacket({
					type: "cdp-open-result",
					sessionId: open.sessionId,
					ok: true,
				}),
			);
			c.socket.send('{"id":1,"method":"Target.getTargets"}');
			assert.equal(parseBrowserCdpPacket(await p.next()).type, "cdp-input");
			p.socket.send(
				encodeBrowserCdpPacket({
					type: "cdp-output",
					sessionId: open.sessionId,
					raw: '{"id":1,"result":{}}',
				}),
			);
			assert.equal(await c.next(), '{"id":1,"result":{}}');
		} finally {
			await f.close();
		}
	},
);

test(
	"scoped credentials cannot reserve another pane, instance or peer and expired credentials fail immediately",
	{ timeout: 5000 },
	async () => {
		const f = await fixture();
		try {
			const p = await f.peer(),
				scope = { ...identity, workspaceId: "workspace", paneId: "pane" },
				token = mintBrowserCdpToken(secret, scope),
				expired = mintBrowserCdpToken(
					secret,
					scope,
					Date.now() - BROWSER_CDP_TOKEN_TTL_MS - 1,
				);
			for (const [path, value] of [
				[
					`/direct/browser/foreign/cdp-v1?workspaceId=workspace&instanceId=${identity.instanceId}`,
					token,
				],
				[
					"/direct/browser/pane/cdp-v1?workspaceId=workspace&instanceId=stale",
					token,
				],
				["/direct/browser-read/v1", token],
				[
					`/direct/browser/pane/cdp-v1?workspaceId=workspace&instanceId=${identity.instanceId}`,
					expired,
				],
			] as const) {
				const status = await new Promise<number>((resolve, reject) => {
					const req = request(
						{
							hostname: "127.0.0.1",
							port: f.port,
							path: `${path}${path.includes("?") ? "&" : "?"}token=${encodeURIComponent(value ?? "")}`,
							headers: {
								Connection: "Upgrade",
								Upgrade: "websocket",
								"Sec-WebSocket-Version": "13",
								"Sec-WebSocket-Key": randomBytes(16).toString("base64"),
							},
						},
						(res) => {
							res.resume();
							resolve(res.statusCode ?? 0);
						},
					);
					req.once("error", () => reject(Error("Owned auth request failed")));
					req.once("upgrade", (_res, socket) => {
						socket.destroy();
						reject(Error("Scoped token was unexpectedly accepted"));
					});
					req.end();
				});
				assert.equal(status, 401);
			}
			assert.equal(p.queue.length, 0);
			assert.equal(f.bridge.isCdpReady(), true);
		} finally {
			await f.close();
		}
	},
);

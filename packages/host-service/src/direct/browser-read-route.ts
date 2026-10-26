import type { NodeWebSocket } from "@hono/node-ws";
import type { Hono } from "hono";
import {
	DirectBrowserBridgeError,
	type DirectBrowserReadBridge,
} from "./browser-read-bridge";

export function registerDirectBrowserReadRoute({
	app,
	upgradeWebSocket,
	bridge,
}: {
	app: Hono;
	upgradeWebSocket: NodeWebSocket["upgradeWebSocket"];
	bridge: DirectBrowserReadBridge;
}) {
	app.get(
		"/direct/browser-read/v1",
		upgradeWebSocket(() => {
			let channel: ReturnType<DirectBrowserReadBridge["attach"]> | null = null;
			return {
				onOpen: (_event, socket) => {
					try {
						channel = bridge.attach({
							send: (raw) => socket.send(raw),
							close: (code, reason) => socket.close(code, reason),
						});
					} catch (error) {
						socket.close(
							error instanceof DirectBrowserBridgeError && error.kind === "busy"
								? 1013
								: 1011,
							"Browser bridge unavailable",
						);
					}
				},
				onMessage: (event, socket) => {
					if (typeof event.data !== "string") {
						socket.close(1003, "Browser bridge requires text frames");
						channel?.close();
						return;
					}
					channel?.receive(event.data);
				},
				onClose: () => channel?.close(),
				onError: () => channel?.close(),
			};
		}),
	);
}

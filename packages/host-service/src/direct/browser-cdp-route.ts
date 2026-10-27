import type { NodeWebSocket } from "@hono/node-ws";
import { BROWSER_CDP_MAX_REQUEST_BYTES } from "@superset/shared/browser-cdp-bridge";
import type { Hono } from "hono";
import { BrowserCdpTransferError } from "./browser-cdp-transfer";
import {
	DirectBrowserBridgeError,
	type DirectBrowserReadBridge,
} from "./browser-read-bridge";

export function browserCdpQueuedBytes(raw: unknown): number {
	if (!raw || typeof raw !== "object") return 0;
	const amount = (raw as { bufferedAmount?: unknown }).bufferedAmount;
	return typeof amount === "number" && Number.isFinite(amount) && amount > 0
		? amount
		: 0;
}

export function registerDirectBrowserCdpRoute({
	app,
	upgradeWebSocket,
	bridge,
}: {
	app: Hono;
	upgradeWebSocket: NodeWebSocket["upgradeWebSocket"];
	bridge: DirectBrowserReadBridge;
}) {
	app.get(
		"/direct/browser/:paneId/cdp-v1",
		upgradeWebSocket((context) => {
			const workspaceId = context.req.query("workspaceId") ?? "",
				paneId = context.req.param("paneId") ?? "";
			const instanceId = context.req.query("instanceId");
			let channel: ReturnType<DirectBrowserReadBridge["connectCdp"]> | null =
				null;
			return {
				onOpen: (_event, socket) => {
					if (
						!workspaceId ||
						workspaceId.length > 256 ||
						!paneId ||
						paneId.length > 256 ||
						(instanceId !== undefined &&
							(instanceId.length < 1 || instanceId.length > 128))
					) {
						socket.close(1008, "Browser CDP scope is required");
						return;
					}
					try {
						channel = bridge.connectCdp(
							{
								workspaceId,
								paneId,
								...(instanceId !== undefined ? { instanceId } : {}),
							},
							{
								send: (raw) => {
									if (
										browserCdpQueuedBytes(socket.raw) >
										BROWSER_CDP_MAX_REQUEST_BYTES
									)
										throw Error("Browser CDP client send queue is full");
									socket.send(raw);
								},
								close: (code, reason) => socket.close(code, reason),
							},
						);
					} catch (error) {
						const busy =
							(error instanceof BrowserCdpTransferError ||
								error instanceof DirectBrowserBridgeError) &&
							error.kind === "busy";
						socket.close(busy ? 1013 : 1011, "Browser CDP is unavailable");
					}
				},
				onMessage: (event, socket) => {
					if (typeof event.data === "string") {
						channel?.receive(event.data);
						return;
					}
					const bytes =
						event.data instanceof ArrayBuffer
							? new Uint8Array(event.data)
							: ArrayBuffer.isView(event.data)
								? new Uint8Array(
										event.data.buffer,
										event.data.byteOffset,
										event.data.byteLength,
									)
								: null;
					if (!bytes || bytes.byteLength > BROWSER_CDP_MAX_REQUEST_BYTES) {
						socket.close(bytes ? 1009 : 1003, "Invalid browser CDP frame");
						channel?.close();
						return;
					}
					channel?.receive(
						new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes),
					);
				},
				onClose: () => channel?.close(),
				onError: () => channel?.close(),
			};
		}),
	);
}

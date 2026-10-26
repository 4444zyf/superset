/**
 * Browser bridge — loopback control surface for the in-app browser panes.
 *
 * The host-service child is the only client: it learns the endpoint and
 * secret via BROWSER_BRIDGE_URL / BROWSER_BRIDGE_SECRET at spawn and proxies
 * its own authenticated `browser.*` tRPC procedures (and the raw CDP
 * WebSocket route) here. Nothing else should hold the secret, so it is never
 * written to disk.
 */

import { randomBytes, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, Server } from "node:http";
import log from "electron-log";
import express from "express";
import { type WebSocket, WebSocketServer } from "ws";
import { setBrowserBridgeInfo } from "./browser-bridge-info";
import { registerBrowserBridgeHttpRoutes } from "./browser-bridge-http";
import {
	browserManager,
	CdpBusyError,
	resolveGuestUrl,
} from "./browser-manager";
import {
	hasSafeStorageKey,
	importCookiesIntoSession,
} from "./chrome-cookie-import";
import {
	listLoginImportSources,
	resolveImportProfile,
} from "./chrome-history-import";

const MAX_CDP_MESSAGE_BYTES = 4 * 1024 * 1024;
const CDP_PATH = /^\/panes\/([^/]+)\/cdp$/;

let server: Server | null = null;

function isAuthorized(secret: string, req: IncomingMessage): boolean {
	const url = new URL(req.url ?? "/", "http://127.0.0.1");
	const bearer = req.headers.authorization?.replace(/^Bearer\s+/i, "");
	const candidate = bearer ?? url.searchParams.get("token") ?? "";
	const a = Buffer.from(candidate);
	const b = Buffer.from(secret);
	return a.length === b.length && timingSafeEqual(a, b);
}

export async function startBrowserBridge(): Promise<void> {
	if (server) return;
	const secret = randomBytes(32).toString("hex");
	const app = express();
	app.use(express.json({ limit: "2mb" }));

	app.use((req, res, next) => {
		if (!isAuthorized(secret, req)) {
			res.status(401).json({ error: "Unauthorized" });
			return;
		}
		next();
	});

	registerBrowserBridgeHttpRoutes(app, {
		manager: browserManager,
		resolveGuestUrl,
		hasSafeStorageKey,
		importCookiesIntoSession,
		listLoginImportSources,
		resolveImportProfile,
	});

	const wss = new WebSocketServer({
		noServer: true,
		maxPayload: MAX_CDP_MESSAGE_BYTES,
	});

	const httpServer = await new Promise<Server>((resolve, reject) => {
		const s = app.listen(0, "127.0.0.1", () => resolve(s));
		s.on("error", reject);
	});

	httpServer.on("upgrade", (req, socket, head) => {
		const url = new URL(req.url ?? "/", "http://127.0.0.1");
		const match = CDP_PATH.exec(url.pathname);
		const workspaceId = url.searchParams.get("workspaceId");
		if (!match || !workspaceId || !isAuthorized(secret, req)) {
			socket.destroy();
			return;
		}
		const paneId = match[1] as string;
		wss.handleUpgrade(req, socket, head, (ws) => {
			handleCdpSocket(paneId, workspaceId, ws);
		});
	});

	const address = httpServer.address();
	if (!address || typeof address === "string") {
		throw new Error("Browser bridge failed to bind a port");
	}
	server = httpServer;
	const endpoint = `http://127.0.0.1:${address.port}`;
	setBrowserBridgeInfo({ endpoint, secret });
	log.info(`[browser-bridge] listening on ${endpoint}`);
}

function handleCdpSocket(
	paneId: string,
	workspaceId: string,
	ws: WebSocket,
): void {
	let session: ReturnType<typeof browserManager.attachCdp>;
	try {
		session = browserManager.attachCdp(
			paneId,
			workspaceId,
			(payload) => {
				if (ws.readyState === ws.OPEN) ws.send(payload);
			},
			(reason) => {
				ws.close(1011, `debugger detached: ${reason}`.slice(0, 100));
			},
		);
	} catch (err) {
		// 1013 (Try Again Later) tells the client the pane is busy with another
		// CDP session and to retry once it disconnects; 1011 = genuine failure.
		const code = err instanceof CdpBusyError ? 1013 : 1011;
		ws.close(code, errorMessage(err).slice(0, 100));
		return;
	}
	ws.on("message", (data) => {
		session.send(data.toString());
	});
	ws.on("close", () => {
		session.detach();
	});
	ws.on("error", () => {
		session.detach();
	});
}

function errorMessage(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
}

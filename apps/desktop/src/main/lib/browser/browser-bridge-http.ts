import { randomBytes } from "node:crypto";
import type { EventEmitter } from "node:events";
import type { Express, Request, Response } from "express";
import type {
	BrowserOpenRequest,
	browserManager,
	resolveGuestUrl,
} from "./browser-manager";
import type {
	hasSafeStorageKey,
	importCookiesIntoSession,
} from "./chrome-cookie-import";
import type {
	listLoginImportSources,
	resolveImportProfile,
} from "./chrome-history-import";

export type BrowserBridgeWebContents = Pick<
	Electron.WebContents,
	| "canGoBack"
	| "goBack"
	| "canGoForward"
	| "goForward"
	| "reload"
	| "reloadIgnoringCache"
	| "session"
>;
export type BrowserBridgeManager = Pick<
	typeof browserManager,
	| "listPanes"
	| "requestOpen"
	| "navigate"
	| "capturePng"
	| "evaluateJS"
	| "getConsoleLogs"
> &
	Pick<EventEmitter, "on" | "off"> & {
		getWebContents(
			paneId: string,
			workspaceId: string,
		): BrowserBridgeWebContents | null;
	};
export interface BrowserBridgeHttpDependencies {
	manager: BrowserBridgeManager;
	resolveGuestUrl: typeof resolveGuestUrl;
	hasSafeStorageKey: typeof hasSafeStorageKey;
	importCookiesIntoSession: typeof importCookiesIntoSession;
	listLoginImportSources: typeof listLoginImportSources;
	resolveImportProfile: typeof resolveImportProfile;
	clock?: {
		setTimeout(
			callback: () => void,
			milliseconds: number,
		): ReturnType<typeof setTimeout>;
		clearTimeout(timer: ReturnType<typeof setTimeout>): void;
	};
}
const OPEN_PANE_TIMEOUT_MS = 15_000;

export function registerBrowserBridgeHttpRoutes(
	app: Pick<Express, "get" | "post">,
	dependencies: BrowserBridgeHttpDependencies,
): void {
	const {
		manager: browserManager,
		resolveGuestUrl,
		hasSafeStorageKey,
		importCookiesIntoSession,
		listLoginImportSources,
		resolveImportProfile,
	} = dependencies;
	const { setTimeout, clearTimeout } = dependencies.clock ?? globalThis;
	const openQueues = new Map<string, Promise<void>>();
	// How many opens are queued per workspace, so a stuck renderer (each open waits
	// up to OPEN_PANE_TIMEOUT_MS) can't let the chain grow without bound.
	const openDepth = new Map<string, number>();
	const MAX_QUEUED_OPENS = 8;

	function requireScope(
		req: Request,
		res: Response,
	): { paneId: string; workspaceId: string } | null {
		const paneId = req.params.paneId as string;
		const raw = req.body?.workspaceId ?? req.query.workspaceId;
		if (typeof raw !== "string" || raw.length === 0) {
			res.status(400).json({ error: "workspaceId is required" });
			return null;
		}
		return { paneId, workspaceId: raw };
	}

	/** Resolve the live, workspace-scoped webContents or 404. */
	function withPane(
		req: Request,
		res: Response,
		fn: (
			wc: BrowserBridgeWebContents,
			paneId: string,
			workspaceId: string,
		) => void,
	): void {
		const scope = requireScope(req, res);
		if (!scope) return;
		const wc = browserManager.getWebContents(scope.paneId, scope.workspaceId);
		if (!wc) {
			res
				.status(404)
				.json({ error: `No live pane ${scope.paneId} in this workspace` });
			return;
		}
		fn(wc, scope.paneId, scope.workspaceId);
	}

	app.get("/panes", (req, res) => {
		const workspaceId =
			typeof req.query.workspaceId === "string"
				? req.query.workspaceId
				: undefined;
		res.json({ panes: browserManager.listPanes(workspaceId) });
	});

	app.post("/open", (req, res) => {
		const { workspaceId, projectId, url, target, show } = req.body ?? {};
		if (typeof workspaceId !== "string" || typeof url !== "string") {
			res.status(400).json({ error: "workspaceId and url are required" });
			return;
		}
		const resolvedTarget = target === "new-tab" ? "new-tab" : "current-tab";

		// Reject a disallowed scheme up front (clear error, no pane created) and
		// normalize bare input the same way the pane will.
		let resolvedUrl: string;
		try {
			resolvedUrl = resolveGuestUrl(url);
		} catch (err) {
			res.status(400).json({ error: errorMessage(err) });
			return;
		}

		if ((openDepth.get(workspaceId) ?? 0) >= MAX_QUEUED_OPENS) {
			res.status(429).json({
				error:
					"Too many pending browser-open requests for this workspace. Try again once the earlier ones settle.",
			});
			return;
		}

		// Each open resolves to "the first pane registered in this workspace that
		// wasn't already open". The registration event can't tell us which request
		// it belongs to, so two concurrent opens in one workspace would both latch
		// onto the same new pane. Serialize opens per workspace instead: the next
		// one only snapshots `known` (and starts listening) after the previous
		// pane is registered, so each request matches exactly its own pane.
		const run = () =>
			new Promise<void>((resolveOpen) => {
				const requestId = randomBytes(8).toString("hex");
				const known = new Set(
					browserManager.listPanes(workspaceId).map((p) => p.paneId),
				);

				let settled = false;
				const finish = (fn: () => void) => {
					if (settled) return;
					settled = true;
					clearTimeout(timer);
					browserManager.off("pane-registered", onRegistered);
					fn();
					resolveOpen();
				};
				const timer = setTimeout(() => {
					finish(() =>
						res.status(504).json({
							error:
								"No browser pane appeared for this workspace. Is the desktop app running and signed in?",
						}),
					);
				}, OPEN_PANE_TIMEOUT_MS);
				// Client hung up before the pane appeared — stop waiting and free the listener.
				res.on("close", () => finish(() => {}));

				const onRegistered = (event: {
					paneId: string;
					workspaceId: string | null;
				}) => {
					if (event.workspaceId !== workspaceId) return;
					if (known.has(event.paneId)) return;
					const info = browserManager
						.listPanes(workspaceId)
						.find((p) => p.paneId === event.paneId);
					finish(() =>
						res.json({
							paneId: event.paneId,
							url: info?.url ?? resolvedUrl,
							title: info?.title ?? "",
						}),
					);
				};
				browserManager.on("pane-registered", onRegistered);

				browserManager.requestOpen({
					workspaceId,
					projectId: typeof projectId === "string" ? projectId : null,
					url: resolvedUrl,
					target: resolvedTarget,
					show: show === true,
					requestId,
				} satisfies BrowserOpenRequest);
			});

		openDepth.set(workspaceId, (openDepth.get(workspaceId) ?? 0) + 1);
		const prev = openQueues.get(workspaceId) ?? Promise.resolve();
		const next = prev.then(run, run);
		openQueues.set(workspaceId, next);
		void next.finally(() => {
			openDepth.set(workspaceId, (openDepth.get(workspaceId) ?? 1) - 1);
			if ((openDepth.get(workspaceId) ?? 0) <= 0) openDepth.delete(workspaceId);
			if (openQueues.get(workspaceId) === next) openQueues.delete(workspaceId);
		});
	});

	app.post("/panes/:paneId/navigate", (req, res) => {
		const scope = requireScope(req, res);
		if (!scope) return;
		const url = req.body?.url;
		if (typeof url !== "string") {
			res.status(400).json({ error: "url is required" });
			return;
		}
		// A disallowed scheme is a bad request (400); a missing pane is a 404.
		let resolvedUrl: string;
		try {
			resolvedUrl = resolveGuestUrl(url);
		} catch (err) {
			res.status(400).json({ error: errorMessage(err) });
			return;
		}
		try {
			browserManager.navigate(scope.paneId, resolvedUrl, scope.workspaceId);
			res.json({ ok: true });
		} catch (err) {
			res.status(404).json({ error: errorMessage(err) });
		}
	});

	app.post("/panes/:paneId/back", (req, res) => {
		withPane(req, res, (wc) => {
			if (wc.canGoBack()) wc.goBack();
			res.json({ ok: true });
		});
	});

	app.post("/panes/:paneId/forward", (req, res) => {
		withPane(req, res, (wc) => {
			if (wc.canGoForward()) wc.goForward();
			res.json({ ok: true });
		});
	});

	app.post("/panes/:paneId/reload", (req, res) => {
		withPane(req, res, (wc) => {
			if (req.body?.hard) {
				wc.reloadIgnoringCache();
			} else {
				wc.reload();
			}
			res.json({ ok: true });
		});
	});

	app.post("/panes/:paneId/screenshot", (req, res) => {
		const scope = requireScope(req, res);
		if (!scope) return;
		browserManager
			.capturePng(scope.paneId, scope.workspaceId)
			.then((base64) => res.json({ base64 }))
			.catch((err) => res.status(404).json({ error: errorMessage(err) }));
	});

	app.post("/panes/:paneId/eval", (req, res) => {
		const scope = requireScope(req, res);
		if (!scope) return;
		const code = req.body?.code;
		if (typeof code !== "string") {
			res.status(400).json({ error: "code is required" });
			return;
		}
		browserManager
			.evaluateJS(scope.paneId, code, scope.workspaceId)
			.then((result) => res.json({ result: result ?? null }))
			.catch((err) => res.status(500).json({ error: errorMessage(err) }));
	});

	app.get("/panes/:paneId/console", (req, res) => {
		withPane(req, res, (_wc, paneId, workspaceId) => {
			res.json({ entries: browserManager.getConsoleLogs(paneId, workspaceId) });
		});
	});

	// Chromium browsers/profiles whose history and logins can be imported.
	app.get("/import-sources", (_req, res) => {
		listLoginImportSources(hasSafeStorageKey)
			.then((sources) => res.json({ sources }))
			.catch((err) => res.status(500).json({ error: errorMessage(err) }));
	});

	// Import logins (cookies) from a system browser into this pane's session.
	app.post("/panes/:paneId/import-cookies", (req, res) => {
		const scope = requireScope(req, res);
		if (!scope) return;
		const sourceId = req.body?.sourceId;
		if (typeof sourceId !== "string" || sourceId.length === 0) {
			res.status(400).json({ error: "sourceId is required" });
			return;
		}
		const profile = resolveImportProfile(sourceId);
		if (!profile) {
			res.status(404).json({ error: "Unknown import source" });
			return;
		}
		const wc = browserManager.getWebContents(scope.paneId, scope.workspaceId);
		if (!wc) {
			res
				.status(404)
				.json({ error: `No live pane ${scope.paneId} in this workspace` });
			return;
		}
		importCookiesIntoSession(wc.session, profile.profileDir, profile.browserKey)
			.then((result) => res.json(result))
			.catch((err) => res.status(500).json({ error: errorMessage(err) }));
	});
}

function errorMessage(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
}

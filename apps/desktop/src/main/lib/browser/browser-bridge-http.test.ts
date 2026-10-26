import { expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import express from "express";
import {
	resolveGuestUrl,
	type BrowserOpenRequest,
	type BrowserPaneInfo,
} from "./browser-manager";
import {
	registerBrowserBridgeHttpRoutes,
	type BrowserBridgeHttpDependencies,
	type BrowserBridgeManager,
	type BrowserBridgeWebContents,
} from "./browser-bridge-http";

async function fixture() {
	const app = express();
	app.use(express.json({ limit: "2mb" }));
	let arrival = Promise.withResolvers<void>();
	app.use((request, _response, next) => {
		if (request.path === "/open") {
			arrival.resolve();
			arrival = Promise.withResolvers<void>();
		}
		next();
	});
	const calls: unknown[][] = [];
	const panes: BrowserPaneInfo[] = [
		{
			paneId: "first",
			workspaceId: "owned",
			url: "http://localhost/first",
			title: "First",
			isLoading: false,
		},
	];
	const openRequests: BrowserOpenRequest[] = [];
	let nextOpen = Promise.withResolvers<BrowserOpenRequest>();
	const timers = new Map<ReturnType<typeof setTimeout>, () => void>();
	const guest: BrowserBridgeWebContents = {
		canGoBack: () => true,
		goBack: () => {
			calls.push(["back"]);
		},
		canGoForward: () => true,
		goForward: () => {
			calls.push(["forward"]);
		},
		reload: () => {
			calls.push(["reload"]);
		},
		reloadIgnoringCache: () => {
			calls.push(["hard-reload"]);
		},
		session: {} as Electron.Session,
	};
	const manager = Object.assign(new EventEmitter(), {
		listPanes: (workspaceId?: string) =>
			panes.filter((p) => !workspaceId || p.workspaceId === workspaceId),
		getWebContents: (paneId: string, workspaceId: string) =>
			panes.some((p) => p.paneId === paneId && p.workspaceId === workspaceId)
				? guest
				: null,
		requestOpen: (request: BrowserOpenRequest) => {
			openRequests.push(request);
			nextOpen.resolve(request);
			nextOpen = Promise.withResolvers<BrowserOpenRequest>();
		},
		navigate: (paneId: string, url: string, workspaceId?: string) => {
			calls.push(["navigate", paneId, url, workspaceId]);
		},
		capturePng: async (paneId: string, workspaceId?: string) => {
			calls.push(["capture", paneId, workspaceId]);
			return "owned-png";
		},
		evaluateJS: async (paneId: string, code: string, workspaceId?: string) => {
			calls.push(["eval", paneId, code, workspaceId]);
			return undefined;
		},
		getConsoleLogs: (paneId: string, workspaceId?: string) => {
			calls.push(["console", paneId, workspaceId]);
			return [
				{ level: "info" as const, message: "Owned console", timestamp: 1 },
			];
		},
	}) satisfies BrowserBridgeManager;
	const dependencies: BrowserBridgeHttpDependencies = {
		manager,
		resolveGuestUrl,
		hasSafeStorageKey: async () => true,
		listLoginImportSources: async () => [],
		resolveImportProfile: (id) =>
			id === "owned-profile"
				? { profileDir: "/owned/profile", browserKey: "chrome" }
				: null,
		importCookiesIntoSession: async (_session, path, key) => {
			calls.push(["import", path, key]);
			return { imported: 2, skipped: 1, keyUnavailable: false };
		},
		clock: {
			setTimeout: (callback, milliseconds) => {
				expect(milliseconds).toBe(15000);
				const timer = {} as ReturnType<typeof setTimeout>;
				timers.set(timer, callback);
				return timer;
			},
			clearTimeout: (timer) => {
				timers.delete(timer);
			},
		},
	};
	registerBrowserBridgeHttpRoutes(app, dependencies);
	const server = app.listen(0, "127.0.0.1");
	await new Promise<void>((resolve) => server.once("listening", resolve));
	const address = server.address();
	if (!address || typeof address === "string")
		throw Error("Owned bridge did not listen");
	return {
		manager,
		panes,
		calls,
		openRequests,
		timers,
		nextOpen: () => nextOpen.promise,
		nextArrival: () => arrival.promise,
		request: (path: string, body?: unknown) =>
			fetch(
				`http://127.0.0.1:${address.port}${path}`,
				body === undefined
					? undefined
					: {
							method: "POST",
							headers: { "Content-Type": "application/json" },
							body: JSON.stringify(body),
						},
			),
		register: (paneId: string, workspaceId = "owned") => {
			panes.push({
				paneId,
				workspaceId,
				url: `http://localhost/${paneId}`,
				title: paneId,
				isLoading: false,
			});
			manager.emit("pane-registered", { paneId, workspaceId });
		},
		close: async () => {
			for (let i = 0; i < 16; i++) {
				for (const fire of [...timers.values()]) fire();
				await Promise.resolve();
			}
			await new Promise<void>((resolve, reject) =>
				server.close((error) => (error ? reject(error) : resolve())),
			);
		},
	};
}

test("listing retains the original optional workspace filter and response shape", async () => {
	const f = await fixture();
	try {
		f.register("other", "other-workspace");
		expect(await (await f.request("/panes?workspaceId=owned")).json()).toEqual({
			panes: [f.panes[0]],
		});
		expect((await (await f.request("/panes")).json()).panes).toHaveLength(2);
	} finally {
		await f.close();
	}
});

test("pane actions require scope and reject a foreign or missing guest", async () => {
	const f = await fixture();
	try {
		const missing = await f.request("/panes/first/reload", {});
		expect(missing.status).toBe(400);
		expect(await missing.json()).toEqual({ error: "workspaceId is required" });
		expect(
			(await f.request("/panes/first/reload", { workspaceId: "other" })).status,
		).toBe(404);
		expect(
			(await f.request("/panes/missing/console?workspaceId=owned")).status,
		).toBe(404);
		expect(f.calls).toEqual([]);
	} finally {
		await f.close();
	}
});

test("navigation and reload retain original URL resolution and hard-reload behavior", async () => {
	const f = await fixture();
	try {
		expect(
			(
				await f.request("/panes/first/navigate", {
					workspaceId: "owned",
					url: "javascript:alert(1)",
				})
			).status,
		).toBe(400);
		expect(
			await (
				await f.request("/panes/first/navigate", {
					workspaceId: "owned",
					url: "localhost:3000",
				})
			).json(),
		).toEqual({ ok: true });
		await f.request("/panes/first/reload", { workspaceId: "owned" });
		await f.request("/panes/first/reload", {
			workspaceId: "owned",
			hard: true,
		});
		expect(f.calls).toEqual([
			["navigate", "first", "http://localhost:3000", "owned"],
			["reload"],
			["hard-reload"],
		]);
	} finally {
		await f.close();
	}
});

test("capture, eval and console delegate the workspace and preserve wire envelopes", async () => {
	const f = await fixture();
	try {
		expect(
			await (
				await f.request("/panes/first/screenshot", { workspaceId: "owned" })
			).json(),
		).toEqual({ base64: "owned-png" });
		expect(
			await (
				await f.request("/panes/first/eval", {
					workspaceId: "owned",
					code: "void 0",
				})
			).json(),
		).toEqual({ result: null });
		expect(
			await (await f.request("/panes/first/console?workspaceId=owned")).json(),
		).toEqual({
			entries: [{ level: "info", message: "Owned console", timestamp: 1 }],
		});
		expect(f.calls).toEqual([
			["capture", "first", "owned"],
			["eval", "first", "void 0", "owned"],
			["console", "first", "owned"],
		]);
	} finally {
		await f.close();
	}
});

test("opening waits for a new pane in the requested workspace and removes listeners", async () => {
	const f = await fixture();
	try {
		const ready = f.nextOpen();
		const response = f.request("/open", {
			workspaceId: "owned",
			url: "localhost:3000",
			target: "new-tab",
			show: true,
		});
		const request = await ready;
		expect(request).toMatchObject({
			workspaceId: "owned",
			projectId: null,
			url: "http://localhost:3000",
			target: "new-tab",
			show: true,
		});
		f.manager.emit("pane-registered", {
			paneId: "first",
			workspaceId: "owned",
		});
		f.register("foreign", "other");
		expect(f.manager.listenerCount("pane-registered")).toBe(1);
		f.register("second");
		expect(await (await response).json()).toEqual({
			paneId: "second",
			url: "http://localhost/second",
			title: "second",
		});
		expect(f.manager.listenerCount("pane-registered")).toBe(0);
		expect(f.timers.size).toBe(0);
	} finally {
		await f.close();
	}
});

test("an abandoned open reaches the original deadline without a real wait", async () => {
	const f = await fixture();
	try {
		const ready = f.nextOpen();
		const response = f.request("/open", {
			workspaceId: "owned",
			url: "http://localhost",
		});
		await ready;
		for (const fire of [...f.timers.values()]) fire();
		expect((await response).status).toBe(504);
		expect(f.manager.listenerCount("pane-registered")).toBe(0);
		expect(f.timers.size).toBe(0);
	} finally {
		await f.close();
	}
});

test("concurrent opens in one workspace wait for distinct registrations in order", async () => {
	const f = await fixture();
	try {
		const firstReady = f.nextOpen();
		const first = f.request("/open", {
			workspaceId: "owned",
			url: "http://localhost/one",
		});
		await firstReady;
		const secondReady = f.nextOpen(),
			arrived = f.nextArrival();
		const second = f.request("/open", {
			workspaceId: "owned",
			url: "http://localhost/two",
		});
		await arrived;
		expect(f.openRequests).toHaveLength(1);
		f.register("second");
		expect((await (await first).json()).paneId).toBe("second");
		await secondReady;
		f.manager.emit("pane-registered", {
			paneId: "second",
			workspaceId: "owned",
		});
		expect(f.manager.listenerCount("pane-registered")).toBe(1);
		f.register("third");
		expect((await (await second).json()).paneId).toBe("third");
		expect(f.openRequests.map((request) => request.url)).toEqual([
			"http://localhost/one",
			"http://localhost/two",
		]);
		expect(f.timers.size).toBe(0);
	} finally {
		await f.close();
	}
});

test("separate bridge instances do not share an open queue for the same workspace id", async () => {
	const first = await fixture(),
		second = await fixture();
	try {
		const firstReady = first.nextOpen(),
			secondReady = second.nextOpen();
		const a = first.request("/open", {
			workspaceId: "owned",
			url: "http://localhost/one",
		});
		await firstReady;
		const b = second.request("/open", {
			workspaceId: "owned",
			url: "http://localhost/two",
		});
		await secondReady;
		expect(first.openRequests).toHaveLength(1);
		expect(second.openRequests).toHaveLength(1);
		first.register("window-one");
		second.register("window-two");
		expect((await (await a).json()).paneId).toBe("window-one");
		expect((await (await b).json()).paneId).toBe("window-two");
	} finally {
		await first.close();
		await second.close();
	}
});

test("cookie imports retain detected-profile validation and the selected guest session", async () => {
	const f = await fixture();
	try {
		expect(await (await f.request("/import-sources")).json()).toEqual({
			sources: [],
		});
		expect(
			(
				await f.request("/panes/first/import-cookies", {
					workspaceId: "owned",
					sourceId: "/arbitrary",
				})
			).status,
		).toBe(404);
		expect(
			await (
				await f.request("/panes/first/import-cookies", {
					workspaceId: "owned",
					sourceId: "owned-profile",
				})
			).json(),
		).toEqual({ imported: 2, skipped: 1, keyUnavailable: false });
		expect(f.calls).toEqual([["import", "/owned/profile", "chrome"]]);
	} finally {
		await f.close();
	}
});

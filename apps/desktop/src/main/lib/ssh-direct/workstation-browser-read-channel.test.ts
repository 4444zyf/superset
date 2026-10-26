import { expect, test } from "bun:test";
import {
	WorkstationBrowserReadChannels,
	type BrowserReadTarget,
} from "./workstation-browser-read-channel";

class Socket extends EventTarget {
	sent: Array<Record<string, unknown>> = [];
	closes: number[] = [];
	send(raw: string) {
		this.sent.push(JSON.parse(raw));
	}
	close(code = 1000) {
		this.closes.push(code);
	}
	packet(packet: unknown) {
		this.dispatchEvent(
			new MessageEvent("message", { data: JSON.stringify(packet) }),
		);
	}
}
function fixture(navigationV1 = false, evaluationV1 = false, openV1 = false) {
	let target: BrowserReadTarget | null = {
		ownerId: 10,
		ownerEpoch: 1,
		descriptor: {
			connectionId: "connection",
			generation: 1,
			backendId: "backend",
			namespaceId: "namespace",
			instanceId: "instance",
		},
	};
	const sockets: Socket[] = [],
		reads: unknown[] = [];
	let duringRead = () => {};
	let capture = () => Promise.resolve("iVBORw0KGgo=");
	const navigation = Promise.withResolvers<{ ok: true }>();
	const evaluation = Promise.withResolvers<{ result: unknown }>();
	let openReleases = 0;
	const open = Promise.withResolvers<{
		paneId: string;
		url: string;
		title: string;
	}>();
	let openStatus = {
		scopeId: crypto.randomUUID(),
		ready: true,
		accepting: true,
	};
	const channels = new WorkstationBrowserReadChannels({
		navigationV1,
		evaluationV1,
		openV1,
		openAvailability: () => openStatus,
		pinOpen: (captured, request, current) => {
			reads.push(["open", captured, request, current()]);
			return Object.assign(() => open.promise, {
				release: () => {
					openReleases++;
				},
			});
		},
		getTarget: () => target,
		openSocket: (id, path) => {
			expect([id, path]).toEqual(["connection", "/direct/browser-read/v1"]);
			const s = new Socket();
			sockets.push(s);
			return s as unknown as WebSocket;
		},
		panes: (captured, current) => ({
			pinEvaluation: (pane, workspace, code) => {
				reads.push(["evaluation", captured, pane, workspace, code, current()]);
				return () => evaluation.promise;
			},
			pinNavigation: (pane, workspace, url) => {
				reads.push(["navigation", captured, pane, workspace, url, current()]);
				return () => navigation.promise;
			},
			listPanes: (workspace) => {
				reads.push([captured, workspace, current()]);
				duringRead();
				return [
					{
						paneId: "pane",
						workspaceId: workspace!,
						url: "http://localhost:3000",
						title: "中文",
						isLoading: false,
					},
				];
			},
			capturePng: (pane, workspace) => {
				reads.push([captured, pane, workspace, current()]);
				return capture();
			},
			getConsoleLogs: (pane, workspace) => {
				reads.push([captured, pane, workspace, current()]);
				duringRead();
				return [{ level: "info", message: "中文 console", timestamp: 1 }];
			},
		}),
	});
	const ready = (socket = sockets.at(-1)!, features = ["readV1"]) => {
		socket.dispatchEvent(new Event("open"));
		socket.packet({
			type: "ready",
			protocol: 1,
			backendId: "backend",
			namespaceId: "namespace",
			instanceId: "instance",
			features,
		});
	};
	const request = (
		type: "list" | "console" = "list",
		socket = sockets.at(-1)!,
	) =>
		socket.packet({
			type: "request",
			id: crypto.randomUUID(),
			operation: {
				type,
				workspaceId: "workspace",
				...(type === "console" ? { paneId: "pane" } : {}),
			},
		});
	return {
		channels,
		navigation,
		evaluation,
		open,
		openReleases: () => openReleases,
		openStatus: () => openStatus,
		setOpenStatus: (value: typeof openStatus) => {
			openStatus = value;
		},
		sockets,
		reads,
		ready,
		request,
		setTarget: (value: BrowserReadTarget | null) => {
			target = value;
		},
		target: () => target!,
		capture: (callback: () => Promise<string>) => {
			capture = callback;
		},
		duringRead: (callback: () => void) => {
			duringRead = callback;
		},
	};
}

test("the desktop hello sends only protocol identity and reads through the captured owner and workspace", () => {
	const f = fixture();
	f.channels.sync("connection");
	f.ready();
	expect(f.sockets[0]!.sent[0]).toEqual({
		type: "hello",
		protocol: 1,
		backendId: "backend",
		namespaceId: "namespace",
		instanceId: "instance",
		features: ["readV1", "capturePngV1"],
	});
	f.request();
	f.request("console");
	expect(f.reads).toEqual([
		[f.target(), "workspace", true],
		[f.target(), "pane", "workspace", true],
	]);
	expect(f.sockets[0]!.sent.slice(1).map((packet) => packet.value)).toEqual([
		{
			panes: [
				{
					paneId: "pane",
					workspaceId: "workspace",
					url: "http://localhost:3000",
					title: "中文",
					isLoading: false,
				},
			],
		},
		{ entries: [{ level: "info", message: "中文 console", timestamp: 1 }] },
	]);
});

test("a closing old socket error cannot cancel the queued new window epoch", () => {
	const f = fixture();
	f.channels.sync("connection");
	f.ready();
	const old = f.sockets[0]!;
	f.setTarget({ ...f.target(), ownerEpoch: 2 });
	f.channels.sync("connection");
	expect(f.sockets.length).toBe(1);
	old.dispatchEvent(new Event("error"));
	old.dispatchEvent(new Event("close"));
	expect(f.sockets.length).toBe(2);
	f.ready();
	f.request();
	expect((f.reads[0] as unknown[])[0]).toEqual(f.target());
	old.dispatchEvent(new Event("close"));
	expect(f.sockets[1]!.closes).toEqual([]);
});

test("unavailable targets do not open a channel and repeated current sync reuses one socket", () => {
	const f = fixture(),
		target = f.target();
	f.setTarget(null);
	f.channels.sync("connection");
	expect(f.sockets).toEqual([]);
	f.setTarget(target);
	f.channels.sync("connection");
	f.channels.sync("connection");
	expect(f.sockets.length).toBe(1);
});

test("changing the connection generation during a pane read withholds the old result", () => {
	const f = fixture();
	f.channels.sync("connection");
	f.ready();
	f.duringRead(() =>
		f.setTarget({
			...f.target(),
			descriptor: { ...f.target().descriptor, generation: 2 },
		}),
	);
	f.request();
	expect(f.sockets[0]!.sent.length).toBe(1);
});

test("a mismatched ready identity closes before any scoped read", () => {
	const f = fixture();
	f.channels.sync("connection");
	f.sockets[0]!.packet({
		type: "ready",
		protocol: 1,
		backendId: "other",
		namespaceId: "namespace",
		instanceId: "instance",
		features: ["readV1", "capturePngV1"],
	});
	f.request();
	expect(f.sockets[0]!.closes).toEqual([1008]);
	expect(f.reads).toEqual([]);
});

test("binary frames are rejected without a browser read", () => {
	const f = fixture();
	f.channels.sync("connection");
	f.ready();
	f.sockets[0]!.dispatchEvent(
		new MessageEvent("message", { data: new Uint8Array([1]) }),
	);
	expect(f.sockets[0]!.closes).toEqual([1008]);
	expect(f.reads).toEqual([]);
});

test("a scoped pane failure returns a bounded failure without internal details", () => {
	const f = fixture();
	f.channels.sync("connection");
	f.ready();
	f.duringRead(() => {
		throw Error("private manager key");
	});
	f.request();
	expect(f.sockets[0]!.sent[1]).toMatchObject({
		type: "result",
		ok: false,
		error: { message: "Browser read failed or pane is no longer current" },
	});
});

test("owner teardown cancels a queued replacement and a closed channel does not reconnect itself", () => {
	const f = fixture();
	f.channels.sync("connection");
	f.ready();
	f.setTarget({ ...f.target(), ownerEpoch: 2 });
	f.channels.sync("connection");
	f.channels.closeAll();
	f.sockets[0]!.dispatchEvent(new Event("close"));
	expect(f.sockets.length).toBe(1);
});

test("negotiated screenshot requests use the captured pane scope and send bounded PNG chunks", async () => {
	const f = fixture(),
		capture = Promise.withResolvers<string>();
	f.capture(() => capture.promise);
	f.channels.sync("connection");
	f.ready(f.sockets[0], ["readV1", "capturePngV1"]);
	const id = crypto.randomUUID();
	f.sockets[0]!.packet({
		type: "capture-request",
		id,
		workspaceId: "workspace",
		paneId: "pane",
	});
	expect(f.reads).toEqual([[f.target(), "pane", "workspace", true]]);
	capture.resolve("iVBORw0KGgo=");
	await capture.promise;
	expect(f.sockets[0]!.sent.slice(1)).toEqual([
		{ type: "capture-chunk", id, index: 0, base64: "iVBORw0KGgo=" },
		{ type: "capture-done", id, ok: true, chunks: 1, base64Chars: 12 },
	]);
});

test("a screenshot finishing after the window epoch changes cannot publish image bytes", async () => {
	const f = fixture(),
		capture = Promise.withResolvers<string>();
	f.capture(() => capture.promise);
	f.channels.sync("connection");
	f.ready(f.sockets[0], ["readV1", "capturePngV1"]);
	f.sockets[0]!.packet({
		type: "capture-request",
		id: crypto.randomUUID(),
		workspaceId: "workspace",
		paneId: "pane",
	});
	f.setTarget({ ...f.target(), ownerEpoch: 2 });
	f.channels.sync("connection");
	capture.resolve("iVBORw0KGgo=");
	await capture.promise;
	expect(f.sockets[0]!.sent.length).toBe(1);
	expect(f.sockets[0]!.closes).toEqual([1000]);
});

test("a backend cannot request screenshots when that feature was not negotiated", () => {
	const f = fixture();
	f.channels.sync("connection");
	f.ready();
	f.sockets[0]!.packet({
		type: "capture-request",
		id: crypto.randomUUID(),
		workspaceId: "workspace",
		paneId: "pane",
	});
	expect(f.reads).toEqual([]);
	expect(f.sockets[0]!.closes).toEqual([1008]);
});

test("negotiated navigation routes only through the pinned owner and acknowledges completion", async () => {
	const f = fixture(true);
	f.channels.sync("connection");
	f.ready(f.sockets[0], ["readV1", "navigateV1"]);
	const id = crypto.randomUUID();
	f.sockets[0]!.packet({
		type: "navigate-request",
		id,
		workspaceId: "workspace",
		paneId: "pane",
		url: "http://localhost:3000/中文",
	});
	expect(f.reads).toEqual([
		[
			"navigation",
			f.target(),
			"pane",
			"workspace",
			"http://localhost:3000/中文",
			true,
		],
	]);
	expect(f.sockets[0]!.sent).toHaveLength(1);
	f.navigation.resolve({ ok: true });
	await f.navigation.promise;
	expect(f.sockets[0]!.sent[1]).toEqual({
		type: "navigate-result",
		id,
		ok: true,
	});
});

test("an old navigation completion cannot acknowledge a changed window epoch", async () => {
	const f = fixture(true);
	f.channels.sync("connection");
	f.ready(f.sockets[0], ["readV1", "navigateV1"]);
	f.sockets[0]!.packet({
		type: "navigate-request",
		id: crypto.randomUUID(),
		workspaceId: "workspace",
		paneId: "pane",
		url: "http://localhost:3000",
	});
	f.setTarget({ ...f.target(), ownerEpoch: 2 });
	f.navigation.resolve({ ok: true });
	await f.navigation.promise;
	expect(f.sockets[0]!.sent).toHaveLength(1);
	expect(f.sockets[0]!.closes).toEqual([1000]);
});

test("a backend cannot navigate when the desktop did not advertise navigation support", () => {
	const f = fixture();
	f.channels.sync("connection");
	f.ready(f.sockets[0], ["readV1", "navigateV1"]);
	f.sockets[0]!.packet({
		type: "navigate-request",
		id: crypto.randomUUID(),
		workspaceId: "workspace",
		paneId: "pane",
		url: "http://localhost:3000",
	});
	expect(f.reads).toEqual([]);
	expect(f.sockets[0]!.closes).toEqual([1008]);
});

test("evaluation replies preserve a falsy result through the negotiated owner", async () => {
	const f = fixture(false, true);
	f.channels.sync("connection");
	f.ready(f.sockets[0], ["readV1", "evaluateV1"]);
	const id = crypto.randomUUID();
	f.sockets[0]!.packet({
		type: "evaluate-request",
		id,
		workspaceId: "workspace",
		paneId: "pane",
		code: "0",
	});
	expect(f.reads).toEqual([
		["evaluation", f.target(), "pane", "workspace", "0", true],
	]);
	expect(f.sockets[0]!.sent).toHaveLength(1);
	f.evaluation.resolve({ result: 0 });
	await f.evaluation.promise;
	expect(f.sockets[0]!.sent[1]).toEqual({
		type: "evaluate-result",
		id,
		ok: true,
		result: 0,
	});
});

test("an old evaluation cannot acknowledge a changed window epoch", async () => {
	const f = fixture(false, true);
	f.channels.sync("connection");
	f.ready(f.sockets[0], ["readV1", "evaluateV1"]);
	f.sockets[0]!.packet({
		type: "evaluate-request",
		id: crypto.randomUUID(),
		workspaceId: "workspace",
		paneId: "pane",
		code: "document.title",
	});
	f.setTarget({ ...f.target(), ownerEpoch: 2 });
	f.evaluation.resolve({ result: "old" });
	await f.evaluation.promise;
	expect(f.sockets[0]!.sent).toHaveLength(1);
	expect(f.sockets[0]!.closes).toEqual([1000]);
});

test("a backend cannot evaluate when the desktop did not advertise evaluation support", () => {
	const f = fixture();
	f.channels.sync("connection");
	f.ready(f.sockets[0], ["readV1", "evaluateV1"]);
	f.sockets[0]!.packet({
		type: "evaluate-request",
		id: crypto.randomUUID(),
		workspaceId: "workspace",
		paneId: "pane",
		code: "document.title",
	});
	expect(f.reads).toEqual([]);
	expect(f.sockets[0]!.closes).toEqual([1008]);
});

test("open availability is published only after openV1 is negotiated", () => {
	const f = fixture(false, false, true);
	f.channels.sync("connection");
	f.ready(f.sockets[0], ["readV1", "openV1"]);
	expect(f.sockets[0]!.sent[0]?.features).toEqual([
		"readV1",
		"capturePngV1",
		"openV1",
	]);
	expect(f.sockets[0]!.sent[1]).toEqual({
		type: "open-availability",
		...f.openStatus(),
	});
	f.setOpenStatus({ ...f.openStatus(), accepting: false });
	f.channels.publishOpenAvailability();
	expect(f.sockets[0]!.sent.at(-1)).toEqual({
		type: "open-availability",
		...f.openStatus(),
	});
	const old = fixture();
	old.channels.sync("connection");
	old.ready(old.sockets[0], ["readV1", "openV1"]);
	old.channels.publishOpenAvailability();
	expect(old.sockets[0]!.sent).toHaveLength(1);
});

test("an open result carries its original view scope while busy availability changes", async () => {
	const f = fixture(false, false, true);
	f.channels.sync("connection");
	f.ready(f.sockets[0], ["readV1", "openV1"]);
	const request = {
		type: "open-request",
		id: crypto.randomUUID(),
		scopeId: f.openStatus().scopeId,
		workspaceId: "workspace",
		projectId: null,
		workspaceName: "Owned",
		url: "http://localhost:3000",
		target: "current-tab",
		show: false,
	};
	f.sockets[0]!.packet(request);
	expect(f.reads).toEqual([["open", f.target(), request, true]]);
	f.setOpenStatus({ ...f.openStatus(), accepting: false });
	f.channels.publishOpenAvailability();
	const result = { paneId: "created", url: request.url, title: "" };
	f.open.resolve(result);
	await f.open.promise;
	expect(f.sockets[0]!.sent.at(-1)).toEqual({
		type: "open-result",
		id: request.id,
		scopeId: request.scopeId,
		ok: true,
		result,
	});
});

test("an old view scope is rejected before renderer dispatch without closing the read channel", async () => {
	const f = fixture(false, false, true);
	f.channels.sync("connection");
	f.ready(f.sockets[0], ["readV1", "openV1"]);
	const request = {
		type: "open-request",
		id: crypto.randomUUID(),
		scopeId: crypto.randomUUID(),
		workspaceId: "workspace",
		projectId: null,
		workspaceName: "Owned",
		url: "http://localhost:3000",
		target: "new-tab",
		show: false,
	};
	f.sockets[0]!.packet(request);
	expect(f.reads).toEqual([]);
	expect(f.sockets[0]!.sent.at(-1)).toMatchObject({
		type: "open-result",
		id: request.id,
		scopeId: request.scopeId,
		ok: false,
	});
	expect(f.sockets[0]!.closes).toEqual([]);
});

test("a scope change while the renderer is running cannot acknowledge the old open", async () => {
	const f = fixture(false, false, true);
	f.channels.sync("connection");
	f.ready(f.sockets[0], ["readV1", "openV1"]);
	const request = {
		type: "open-request",
		id: crypto.randomUUID(),
		scopeId: f.openStatus().scopeId,
		workspaceId: "workspace",
		projectId: null,
		workspaceName: "Owned",
		url: "http://localhost:3000",
		target: "current-tab",
		show: false,
	};
	f.sockets[0]!.packet(request);
	f.setOpenStatus({ ...f.openStatus(), scopeId: crypto.randomUUID() });
	f.channels.publishOpenAvailability();
	f.open.resolve({ paneId: "old", url: request.url, title: "" });
	await f.open.promise;
	expect(f.sockets[0]!.sent.at(-1)).toMatchObject({
		type: "open-result",
		id: request.id,
		scopeId: request.scopeId,
		ok: false,
	});
	expect(f.sockets[0]!.closes).toEqual([]);
});

test("closing a read channel releases its deferred renderer open exactly once", async () => {
	const f = fixture(false, false, true);
	f.channels.sync("connection");
	f.ready(f.sockets[0], ["readV1", "openV1"]);
	const request = {
		type: "open-request",
		id: crypto.randomUUID(),
		scopeId: f.openStatus().scopeId,
		workspaceId: "workspace",
		projectId: null,
		workspaceName: "Owned",
		url: "http://localhost:3000",
		target: "current-tab",
		show: false,
	};
	f.sockets[0]!.packet(request);
	f.channels.closeAll();
	expect(f.openReleases()).toBe(1);
	f.open.resolve({ paneId: "old", url: request.url, title: "" });
	await f.open.promise;
	expect(f.openReleases()).toBe(1);
	expect(f.sockets[0]!.sent.some((p) => p.type === "open-result")).toBe(false);
});

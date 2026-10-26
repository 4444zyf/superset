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
function fixture() {
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
	const channels = new WorkstationBrowserReadChannels({
		getTarget: () => target,
		openSocket: (id, path) => {
			expect([id, path]).toEqual(["connection", "/direct/browser-read/v1"]);
			const s = new Socket();
			sockets.push(s);
			return s as unknown as WebSocket;
		},
		panes: (captured, current) => ({
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
			getConsoleLogs: (pane, workspace) => {
				reads.push([captured, pane, workspace, current()]);
				duringRead();
				return [{ level: "info", message: "中文 console", timestamp: 1 }];
			},
		}),
	});
	const ready = (socket = sockets.at(-1)!) => {
		socket.dispatchEvent(new Event("open"));
		socket.packet({
			type: "ready",
			protocol: 1,
			backendId: "backend",
			namespaceId: "namespace",
			instanceId: "instance",
			features: ["readV1"],
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
		sockets,
		reads,
		ready,
		request,
		setTarget: (value: BrowserReadTarget | null) => {
			target = value;
		},
		target: () => target!,
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
		features: ["readV1"],
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
		features: ["readV1"],
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

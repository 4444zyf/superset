import { expect, test } from "bun:test";
import type { BrowserReadTarget } from "./workstation-browser-read-channel";
import { WorkstationBrowserReadChannels } from "./workstation-browser-read-channel";

class Socket extends EventTarget {
	sent: Record<string, unknown>[] = [];
	closes: number[] = [];
	bufferedAmount = 0;
	send(raw: string) {
		this.sent.push(JSON.parse(raw));
	}
	close(code = 1000) {
		this.closes.push(code);
	}
	packet(value: unknown) {
		this.dispatchEvent(
			new MessageEvent("message", { data: JSON.stringify(value) }),
		);
	}
}
function fixture(cdpV1 = false, callback = true) {
	let target: BrowserReadTarget = {
		ownerId: 7,
		ownerEpoch: 1,
		descriptor: {
			connectionId: "connection",
			generation: 1,
			backendId: "backend",
			namespaceId: "namespace",
			instanceId: "instance",
		},
	};
	const socket = new Socket(),
		sessions: Array<{
			sent: string[];
			releases: number;
			callbacks: {
				onMessage: (raw: string) => void;
				onDetach: (reason: string) => void;
			};
		}> = [];
	const calls: unknown[] = [];
	const channels = new WorkstationBrowserReadChannels({
		cdpV1,
		...(callback
			? {
					pinCdp: (
						captured: BrowserReadTarget,
						input: unknown,
						current: () => boolean,
					) => {
						calls.push([captured, input, current()]);
						let s: (typeof sessions)[number] | undefined;
						return {
							release: () => {
								if (s) s.releases++;
							},
							open: (callbacks: (typeof sessions)[number]["callbacks"]) => {
								s = { sent: [], releases: 0, callbacks };
								sessions.push(s);
								return {
									send: (raw: string) => s?.sent.push(raw),
									detach: () => {
										throw Error("Use captured release");
									},
								};
							},
						};
					},
				}
			: {}),
		getTarget: () => target,
		openSocket: () => socket as unknown as WebSocket,
		panes: () => ({
			listPanes: () => [],
			getConsoleLogs: () => [],
			capturePng: async () => "",
		}),
	});
	channels.sync("connection");
	socket.dispatchEvent(new Event("open"));
	const ready = (features = ["readV1", "cdpV1"]) =>
		socket.packet({
			type: "ready",
			protocol: 1,
			backendId: "backend",
			namespaceId: "namespace",
			instanceId: "instance",
			features,
		});
	const open = () => {
		const p = {
			type: "cdp-open",
			sessionId: crypto.randomUUID(),
			workspaceId: "workspace",
			paneId: "pane",
		};
		socket.packet(p);
		return p;
	};
	return {
		socket,
		sessions,
		calls,
		channels,
		ready,
		open,
		target: () => target,
		retire: () => {
			target = { ...target, ownerEpoch: 2 };
		},
	};
}
test("CDP requires both explicit desktop opt-in and a pin callback", () => {
	for (const f of [fixture(), fixture(true, false)]) {
		f.ready();
		f.open();
		expect(f.socket.sent[0]?.features).toEqual(["readV1", "capturePngV1"]);
		expect(f.calls).toEqual([]);
		expect(f.socket.closes).toEqual([1008]);
	}
});
test("negotiated CDP packets are independent of original read packet limits and use the captured owner", () => {
	const f = fixture(true);
	f.ready();
	const p = f.open();
	expect(f.socket.sent[0]?.features).toEqual([
		"readV1",
		"capturePngV1",
		"cdpV1",
	]);
	expect(f.calls).toEqual([
		[f.target(), { workspaceId: "workspace", paneId: "pane" }, true],
	]);
	expect(f.socket.sent[1]).toEqual({
		type: "cdp-open-result",
		sessionId: p.sessionId,
		ok: true,
	});
	const raw = "x".repeat(4 * 1024 * 1024 + 1);
	f.sessions[0]?.callbacks.onMessage(raw);
	expect(f.socket.sent[2]?.type).toBe("cdp-output");
	expect(f.socket.sent[2]?.raw === raw).toBe(true);
	f.socket.packet({
		type: "cdp-input",
		sessionId: p.sessionId,
		raw: "original command",
	});
	expect(f.sessions[0]?.sent).toEqual(["original command"]);
	f.channels.closeAll();
	expect(f.sessions[0]?.releases).toBe(1);
});
test("an old ready peer cannot send CDP until it explicitly negotiates that feature", () => {
	const f = fixture(true);
	f.ready(["readV1"]);
	f.open();
	expect(f.calls).toEqual([]);
	expect(f.socket.closes).toEqual([1008]);
});
test("retiring a window or closing its actual socket releases all exact CDP pins", () => {
	for (const how of ["owner", "socket"]) {
		const f = fixture(true);
		f.ready();
		f.open();
		if (how === "owner") {
			f.retire();
			f.sessions[0]?.callbacks.onMessage("late old event");
		} else f.socket.dispatchEvent(new Event("close"));
		expect(f.sessions[0]?.releases).toBe(1);
		expect(f.socket.sent.filter((p) => p.type === "cdp-output")).toEqual([]);
		f.channels.closeAll();
		expect(f.sessions[0]?.releases).toBe(1);
	}
});
test("a full new CDP send queue retires the socket and releases the pinned session", () => {
	const f = fixture(true);
	f.ready();
	f.open();
	f.socket.bufferedAmount = 100 * 1024 * 1024;
	f.sessions[0]?.callbacks.onMessage("queued event");
	expect(f.sessions[0]?.releases).toBe(1);
	expect(f.socket.closes).toEqual([1011]);
	expect(f.socket.sent.filter((p) => p.type === "cdp-output")).toEqual([]);
});

import { expect, test } from "bun:test";
import {
	type BrowserReadTarget,
	WorkstationBrowserReadChannels,
} from "./workstation-browser-read-channel";

class Socket extends EventTarget {
	sent: Record<string, unknown>[] = [];
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
function fixture(reloadV1 = false) {
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
		done = Promise.withResolvers<{ ok: true }>(),
		calls: unknown[] = [];
	const channels = new WorkstationBrowserReadChannels({
		reloadV1,
		getTarget: () => target,
		openSocket: () => socket as unknown as WebSocket,
		panes: (owner, current) => ({
			listPanes: () => [],
			getConsoleLogs: () => [],
			capturePng: async () => "",
			pinReload: (pane, workspace, hard) => {
				calls.push([owner, pane, workspace, hard, current()]);
				return () => done.promise;
			},
		}),
	});
	channels.sync("connection");
	socket.dispatchEvent(new Event("open"));
	const ready = () =>
		socket.packet({
			type: "ready",
			protocol: 1,
			backendId: "backend",
			namespaceId: "namespace",
			instanceId: "instance",
			features: ["readV1", "reloadV1"],
		});
	const request = (hard: unknown = false) => {
		const id = crypto.randomUUID();
		socket.packet({
			type: "reload-request",
			id,
			workspaceId: "owned",
			paneId: "page",
			hard,
		});
		return id;
	};
	return {
		channels,
		socket,
		done,
		calls,
		ready,
		request,
		target: () => target,
		retire: () => {
			target = { ...target, ownerEpoch: 2 };
		},
	};
}
test("reload requires an explicit desktop opt-in even when the backend announces support", () => {
	const f = fixture();
	f.ready();
	f.request();
	expect(f.socket.sent[0]?.features).toEqual(["readV1", "capturePngV1"]);
	expect(f.calls).toEqual([]);
	expect(f.socket.closes).toEqual([1008]);
});
test("negotiated reload acknowledges only its captured owner and cache intent", async () => {
	const f = fixture(true);
	f.ready();
	const id = f.request(true);
	expect(f.socket.sent[0]?.features).toContain("reloadV1");
	expect(f.calls).toEqual([[f.target(), "page", "owned", true, true]]);
	expect(f.socket.sent).toHaveLength(1);
	f.done.resolve({ ok: true });
	await f.done.promise;
	expect(f.socket.sent[1]).toEqual({ type: "reload-result", id, ok: true });
	f.channels.closeAll();
});
test("an old reload completion cannot acknowledge another renderer epoch", async () => {
	const f = fixture(true);
	f.ready();
	f.request();
	f.retire();
	f.done.resolve({ ok: true });
	await f.done.promise;
	expect(f.socket.sent).toHaveLength(1);
	expect(f.socket.closes).toEqual([1000]);
});
test("concurrent reload packets retire the connection without a second dispatch", async () => {
	const f = fixture(true);
	f.ready();
	f.request();
	f.request();
	expect(f.calls).toHaveLength(1);
	expect(f.socket.closes).toEqual([1008]);
	f.done.resolve({ ok: true });
	await f.done.promise;
	expect(f.socket.sent).toHaveLength(1);
});
test("malformed cache intent cannot dispatch a reload", () => {
	const f = fixture(true);
	f.ready();
	f.request("false");
	expect(f.calls).toEqual([]);
	expect(f.socket.closes).toEqual([1008]);
});

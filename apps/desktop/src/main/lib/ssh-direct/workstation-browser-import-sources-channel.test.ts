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
const source = {
	id: "/owned/配置/Default",
	browserName: "Google Chrome",
	profileName: "Owned 中文",
	browserKey: "chrome",
	future: "kept",
};
function fixture(importSourcesV1 = false, callback = true) {
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
		done = Promise.withResolvers<{ sources: (typeof source)[] }>(),
		calls: unknown[] = [];
	const channels = new WorkstationBrowserReadChannels({
		importSourcesV1,
		...(callback
			? {
					importSources: (
						captured: BrowserReadTarget,
						current: () => boolean,
					) => {
						calls.push([captured, current()]);
						return done.promise;
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
	const ready = () =>
		socket.packet({
			type: "ready",
			protocol: 1,
			backendId: "backend",
			namespaceId: "namespace",
			instanceId: "instance",
			features: ["readV1", "importSourcesV1"],
		});
	const request = () => {
		const id = crypto.randomUUID();
		socket.packet({ type: "import-sources-request", id });
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
test("login sources require both desktop opt-in and the original listing callback", () => {
	for (const f of [fixture(), fixture(true, false)]) {
		f.ready();
		f.request();
		expect(f.socket.sent[0]?.features).toEqual(["readV1", "capturePngV1"]);
		expect(f.calls).toEqual([]);
		expect(f.socket.closes).toEqual([1008]);
	}
});
test("the sources reply is fenced to the captured actual renderer and retains original metadata", async () => {
	const f = fixture(true);
	f.ready();
	const id = f.request();
	expect(f.socket.sent[0]?.features).toContain("importSourcesV1");
	expect(f.calls).toEqual([[f.target(), true]]);
	expect(f.socket.sent).toHaveLength(1);
	f.done.resolve({ sources: [source] });
	await f.done.promise;
	expect(f.socket.sent[1]).toEqual({
		type: "import-sources-result",
		id,
		ok: true,
		result: { sources: [source] },
	});
	f.channels.closeAll();
});
test("source data read for an old renderer epoch cannot be returned to its replacement", async () => {
	const f = fixture(true);
	f.ready();
	f.request();
	f.retire();
	f.done.resolve({ sources: [source] });
	await f.done.promise;
	expect(f.socket.sent).toHaveLength(1);
	expect(f.socket.closes).toEqual([1000]);
});
test("an excessive list returns an explicit failure without exposing its private rows", async () => {
	const f = fixture(true);
	f.ready();
	const id = f.request();
	f.done.resolve({
		sources: Array(513).fill({ ...source, id: "OWNED-PRIVATE-PROFILE" }),
	});
	await f.done.promise;
	expect(f.socket.sent[1]).toMatchObject({
		type: "import-sources-result",
		id,
		ok: false,
	});
	expect(JSON.stringify(f.socket.sent[1])).not.toContain(
		"OWNED-PRIVATE-PROFILE",
	);
	f.channels.closeAll();
});
test("a second pending sources request cannot start another profile listing", async () => {
	const f = fixture(true);
	f.ready();
	f.request();
	f.request();
	expect(f.calls).toHaveLength(1);
	expect(f.socket.closes).toEqual([1008]);
	f.done.resolve({ sources: [source] });
	await f.done.promise;
	expect(f.socket.sent).toHaveLength(1);
});

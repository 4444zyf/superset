import { expect, test } from "bun:test";
import {
	browserCapturePackets,
	encodeBrowserBridgePacket,
	BROWSER_BRIDGE_MAX_MESSAGE_BYTES,
	type BrowserBridgePacket,
} from "@superset/shared/browser-bridge";
import { DirectBrowserReadBridge } from "./browser-read-bridge";

const identity = {
	backendId: "backend",
	namespaceId: "namespace",
	instanceId: "instance",
};
const png =
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5f8AAAAASUVORK5CYII=";
function fixture(features = ["readV1", "capturePngV1"]) {
	const tasks = new Set<() => void>(),
		packets: BrowserBridgePacket[] = [],
		closed: number[] = [];
	const bridge = new DirectBrowserReadBridge(identity, {
		schedule: (_delay, callback) => {
			tasks.add(callback);
			return () => {
				tasks.delete(callback);
			};
		},
	});
	const transport = {
		send: (raw: string) => {
			packets.push(JSON.parse(raw));
		},
		close: (code: number) => {
			closed.push(code);
		},
	};
	const peer = bridge.attach(transport);
	peer.receive(
		JSON.stringify({ type: "hello", protocol: 1, ...identity, features }),
	);
	const latest = () => {
		const packet = packets.at(-1);
		if (!packet || !("id" in packet)) throw Error("Missing request");
		return packet;
	};
	const reply = (id: string, data = png) => {
		for (const packet of browserCapturePackets(id, data))
			peer.receive(encodeBrowserBridgePacket(packet));
	};
	return { bridge, peer, tasks, packets, closed, latest, reply, transport };
}

test("read-only peers remain ready but cannot receive a screenshot request", async () => {
	const f = fixture(["readV1"]);
	try {
		expect(f.bridge.isReady()).toBe(true);
		expect(f.bridge.isCaptureReady()).toBe(false);
		await expect(f.bridge.capturePng("owned", "pane")).rejects.toMatchObject({
			kind: "unavailable",
		});
		expect(f.packets).toHaveLength(1);
		expect(f.packets[0]).toMatchObject({ features: ["readV1"] });
	} finally {
		f.bridge.dispose();
	}
});

test("negotiated screenshots retain scope and the original base64 result envelope", async () => {
	const f = fixture();
	try {
		expect(f.bridge.isCaptureReady()).toBe(true);
		const capture = f.bridge.capturePng("owned", "pane");
		expect(f.latest()).toMatchObject({
			type: "capture-request",
			workspaceId: "owned",
			paneId: "pane",
		});
		f.reply(f.latest().id);
		expect(await capture).toEqual({ base64: png });
		expect(f.tasks.size).toBe(0);
	} finally {
		f.bridge.dispose();
	}
});

test("screenshots larger than one original frame use bounded chunks without raising the frame limit", async () => {
	const f = fixture();
	try {
		const base64 = Buffer.concat([
			Buffer.from("89504e470d0a1a0a", "hex"),
			Buffer.alloc(4 * 1024 * 1024, 42),
		]).toString("base64");
		expect(base64.length).toBeGreaterThan(BROWSER_BRIDGE_MAX_MESSAGE_BYTES);
		const capture = f.bridge.capturePng("owned", "pane"),
			id = f.latest().id;
		for (const packet of browserCapturePackets(id, base64)) {
			const raw = encodeBrowserBridgePacket(packet);
			expect(Buffer.byteLength(raw)).toBeLessThan(
				BROWSER_BRIDGE_MAX_MESSAGE_BYTES,
			);
			f.peer.receive(raw);
		}
		expect(await capture).toEqual({ base64 });
	} finally {
		f.bridge.dispose();
	}
});

test("a pending screenshot refuses another capture while metadata reads still complete", async () => {
	const f = fixture();
	try {
		const capture = f.bridge.capturePng("owned", "pane"),
			id = f.latest().id;
		await expect(f.bridge.capturePng("owned", "other")).rejects.toMatchObject({
			kind: "busy",
		});
		const listing = f.bridge.listPanes("owned"),
			request = f.latest();
		f.peer.receive(
			JSON.stringify({
				type: "result",
				id: request.id,
				ok: true,
				value: { panes: [] },
			}),
		);
		expect(await listing).toEqual({ panes: [] });
		f.reply(id);
		expect(await capture).toEqual({ base64: png });
	} finally {
		f.bridge.dispose();
	}
});

test("an out-of-order screenshot chunk invalidates the peer and settles its pending capture", async () => {
	const f = fixture();
	try {
		const capture = f.bridge
				.capturePng("owned", "pane")
				.catch((error) => error),
			id = f.latest().id;
		f.peer.receive(
			JSON.stringify({ type: "capture-chunk", id, index: 1, base64: png }),
		);
		expect(await capture).toMatchObject({ kind: "invalid" });
		expect(f.closed).toEqual([1008]);
		expect(f.bridge.isCaptureReady()).toBe(false);
	} finally {
		f.bridge.dispose();
	}
});

test("an incomplete screenshot cannot resolve successfully", async () => {
	const f = fixture();
	try {
		const capture = f.bridge
				.capturePng("owned", "pane")
				.catch((error) => error),
			id = f.latest().id;
		f.peer.receive(
			JSON.stringify({
				type: "capture-done",
				id,
				ok: true,
				chunks: 1,
				base64Chars: png.length,
			}),
		);
		expect(await capture).toMatchObject({ kind: "invalid" });
		expect(f.tasks.size).toBe(0);
	} finally {
		f.bridge.dispose();
	}
});

test("a screenshot timeout ignores late chunks while the same peer can serve a new request", async () => {
	const f = fixture();
	try {
		const capture = f.bridge
				.capturePng("owned", "pane")
				.catch((error) => error),
			id = f.latest().id;
		[...f.tasks][0]!();
		expect(await capture).toMatchObject({ kind: "timeout" });
		const newer = f.bridge.capturePng("owned", "pane"),
			newId = f.latest().id;
		f.reply(id);
		f.reply(newId);
		expect(await newer).toEqual({ base64: png });
		expect(f.bridge.isReady()).toBe(true);
	} finally {
		f.bridge.dispose();
	}
});

test("disconnect rejects a screenshot and old chunks cannot affect a replacement peer", async () => {
	const f = fixture();
	try {
		const capture = f.bridge
				.capturePng("owned", "pane")
				.catch((error) => error),
			id = f.latest().id;
		f.peer.close();
		expect(await capture).toMatchObject({ kind: "unavailable" });
		const peer = f.bridge.attach(f.transport);
		peer.receive(
			JSON.stringify({
				type: "hello",
				protocol: 1,
				...identity,
				features: ["readV1", "capturePngV1"],
			}),
		);
		f.reply(id);
		expect(f.bridge.isCaptureReady()).toBe(true);
	} finally {
		f.bridge.dispose();
	}
});

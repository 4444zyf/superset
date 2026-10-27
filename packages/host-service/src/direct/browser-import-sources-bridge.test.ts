import { expect, test } from "bun:test";
import { DirectBrowserReadBridge } from "./browser-read-bridge";

const identity = {
	backendId: "backend",
	namespaceId: "namespace",
	instanceId: "instance",
};
function fixture(features = ["readV1", "importSourcesV1"]) {
	const packets: Record<string, unknown>[] = [];
	const closed: unknown[] = [];
	const tasks = new Set<() => void>();
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
		close: (code: number, reason: string) => {
			closed.push({ code, reason });
		},
	};
	const hello = { type: "hello", protocol: 1, ...identity, features };
	const peer = bridge.attach(transport);
	peer.receive(JSON.stringify(hello));
	const latest = () => {
		const packet = packets.at(-1);
		if (packet?.type !== "import-sources-request")
			throw Error("Missing owned source request");
		return packet;
	};
	return { bridge, peer, packets, closed, tasks, transport, hello, latest };
}
const source = {
	id: "/owned/配置/Default",
	browserName: "Google Chrome",
	profileName: "Owned 中文",
	browserKey: "chrome",
	future: "kept",
};
test("read and mutation features cannot enable login source reads without explicit negotiation", async () => {
	const f = fixture([
		"readV1",
		"capturePngV1",
		"navigateV1",
		"evaluateV1",
		"openV1",
		"reloadV1",
	]);
	try {
		expect(f.bridge.isImportSourcesReady()).toBe(false);
		await expect(f.bridge.importSources()).rejects.toMatchObject({
			kind: "unavailable",
		});
		expect(f.packets).toHaveLength(1);
	} finally {
		f.bridge.dispose();
	}
});
test("negotiated source read sends no path and preserves the original source result shape", async () => {
	const f = fixture();
	try {
		const result = f.bridge.importSources(),
			packet = f.latest();
		expect(Object.keys(packet).sort()).toEqual(["id", "type"]);
		f.peer.receive(
			JSON.stringify({
				type: "import-sources-result",
				id: packet.id,
				ok: true,
				result: { sources: [source] },
			}),
		);
		expect(await result).toEqual({ sources: [source] });
		expect(f.tasks.size).toBe(0);
	} finally {
		f.bridge.dispose();
	}
});
test("source reads use a bounded slot and release it after a result", async () => {
	const f = fixture();
	try {
		const first = f.bridge.importSources();
		await expect(f.bridge.importSources()).rejects.toMatchObject({
			kind: "busy",
		});
		f.peer.receive(
			JSON.stringify({
				type: "import-sources-result",
				id: f.latest().id,
				ok: true,
				result: { sources: [] },
			}),
		);
		expect(await first).toEqual({ sources: [] });
		const second = f.bridge.importSources();
		f.peer.receive(
			JSON.stringify({
				type: "import-sources-result",
				id: f.latest().id,
				ok: true,
				result: { sources: [source] },
			}),
		);
		expect(await second).toEqual({ sources: [source] });
		expect(f.tasks.size).toBe(0);
	} finally {
		f.bridge.dispose();
	}
});
test("a timed-out source read retires its peer and cannot be acknowledged by a later connection", async () => {
	const f = fixture();
	try {
		const first = f.bridge.importSources().catch((e) => e),
			old = f.latest();
		const timeout = [...f.tasks][0];
		if (!timeout) throw Error("Missing owned source deadline");
		timeout();
		expect(await first).toMatchObject({ kind: "timeout" });
		expect(f.bridge.isReady()).toBe(false);
		expect(f.closed).toMatchObject([{ code: 1011 }]);
		const peer = f.bridge.attach(f.transport);
		peer.receive(JSON.stringify(f.hello));
		const next = f.bridge.importSources(),
			latest = f.latest();
		f.peer.receive(
			JSON.stringify({
				type: "import-sources-result",
				id: old.id,
				ok: true,
				result: { sources: [source] },
			}),
		);
		peer.receive(
			JSON.stringify({
				type: "import-sources-result",
				id: latest.id,
				ok: true,
				result: { sources: [] },
			}),
		);
		expect(await next).toEqual({ sources: [] });
	} finally {
		f.bridge.dispose();
	}
});
test("malformed source data retires the peer without echoing private profile contents", async () => {
	const f = fixture();
	try {
		const result = f.bridge.importSources().catch((e) => e);
		f.peer.receive(
			JSON.stringify({
				type: "import-sources-result",
				id: f.latest().id,
				ok: true,
				result: { sources: [{ id: "OWNED-PRIVATE-PROFILE" }] },
			}),
		);
		expect(await result).toMatchObject({ kind: "invalid" });
		expect(JSON.stringify(f.closed)).not.toContain("OWNED-PRIVATE-PROFILE");
		expect(f.tasks.size).toBe(0);
	} finally {
		f.bridge.dispose();
	}
});
test("a source-list error releases the slot without retrying or dropping the ready peer", async () => {
	const f = fixture();
	try {
		const result = f.bridge.importSources().catch((e) => e);
		f.peer.receive(
			JSON.stringify({
				type: "import-sources-result",
				id: f.latest().id,
				ok: false,
				error: { message: "Owned unavailable source" },
			}),
		);
		expect(await result).toMatchObject({
			kind: "failed",
			message: "Owned unavailable source",
		});
		expect(f.bridge.isImportSourcesReady()).toBe(true);
		expect(f.tasks.size).toBe(0);
		expect(
			f.packets.filter((p) => p.type === "import-sources-request"),
		).toHaveLength(1);
	} finally {
		f.bridge.dispose();
	}
});
test("closing the desktop settles its source read once and removes the timer", async () => {
	const f = fixture();
	try {
		const result = f.bridge.importSources().catch((e) => e);
		f.peer.close();
		expect(await result).toMatchObject({ kind: "unavailable" });
		expect(f.tasks.size).toBe(0);
		expect(f.bridge.isImportSourcesReady()).toBe(false);
		expect(
			f.packets.filter((p) => p.type === "import-sources-request"),
		).toHaveLength(1);
	} finally {
		f.bridge.dispose();
	}
});

import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import type { BrowserBridgePacket } from "@superset/shared/browser-bridge";
import { DirectBrowserReadBridge } from "./browser-read-bridge";
import { runBrowserReloadOperation } from "./browser-reload-operation";
import { DirectOperationStore } from "./operations";

const identity = {
	backendId: "backend",
	namespaceId: "namespace",
	instanceId: "instance",
};
function fixture(features = ["readV1", "reloadV1"]) {
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
	const hello = { type: "hello", protocol: 1, ...identity, features };
	peer.receive(JSON.stringify(hello));
	const input = {
		workspaceId: "owned",
		paneId: "page",
		hard: false,
	};
	const request = () => {
		const packet = packets.at(-1);
		if (!packet || packet.type !== "reload-request")
			throw Error("No owned reload request");
		return packet;
	};
	return {
		bridge,
		peer,
		input,
		tasks,
		packets,
		transport,
		hello,
		request,
		closed,
	};
}

test("other browser features cannot enable reload before its own negotiation", () => {
	const f = fixture(["readV1", "navigateV1", "evaluateV1", "openV1"]);
	try {
		expect(f.bridge.isReloadReady()).toBe(false);
		expect(() => f.bridge.pinReload(f.input)).toThrow("unavailable");
		expect(f.packets).toHaveLength(1);
	} finally {
		f.bridge.dispose();
	}
});

test("pinning reserves the mutation slot without dispatch or a real timer", async () => {
	const f = fixture();
	try {
		const first = f.bridge.pinReload(f.input);
		expect(f.packets).toHaveLength(1);
		expect(f.tasks.size).toBe(0);
		expect(() => f.bridge.pinReload(f.input)).toThrow("already pending");
		const pending = first();
		expect(f.request()).toMatchObject({ type: "reload-request", ...f.input });
		f.peer.receive(
			JSON.stringify({ type: "reload-result", id: f.request().id, ok: true }),
		);
		expect(await pending).toEqual({ ok: true });
		expect(f.tasks.size).toBe(0);
		first.release?.();
		expect(f.bridge.isReloadReady()).toBe(true);
	} finally {
		f.bridge.dispose();
	}
});

test("a pin from a closed peer cannot dispatch to its replacement", async () => {
	const f = fixture();
	try {
		const pinned = f.bridge.pinReload(f.input);
		f.peer.close();
		const newer = f.bridge.attach(f.transport);
		newer.receive(JSON.stringify(f.hello));
		await expect(pinned()).rejects.toMatchObject({ kind: "unavailable" });
		expect(
			f.packets.filter((packet) => packet.type === "reload-request"),
		).toEqual([]);
		pinned.release?.();
		expect(f.bridge.isReloadReady()).toBe(true);
	} finally {
		f.bridge.dispose();
	}
});

test("a completed reload callback cannot issue a second request", async () => {
	const f = fixture();
	try {
		const pinned = f.bridge.pinReload(f.input),
			pending = pinned();
		f.peer.receive(
			JSON.stringify({ type: "reload-result", id: f.request().id, ok: true }),
		);
		await pending;
		await expect(pinned()).rejects.toMatchObject({ kind: "unavailable" });
		expect(
			f.packets.filter((packet) => packet.type === "reload-request"),
		).toHaveLength(1);
	} finally {
		f.bridge.dispose();
	}
});

test("a reload timeout retires the peer and cannot bind its acknowledgement to a later peer", async () => {
	const f = fixture();
	try {
		const pending = f.bridge
				.pinReload(f.input)()
				.catch((error) => error),
			request = f.request();
		const timeout = [...f.tasks][0];
		expect(timeout).toBeFunction();
		if (!timeout) throw Error("Missing owned acknowledgement timer");
		timeout();
		expect(await pending).toMatchObject({ kind: "timeout" });
		expect(f.bridge.isReady()).toBe(false);
		expect(f.closed).toEqual([1011]);
		const peer = f.bridge.attach(f.transport);
		peer.receive(JSON.stringify(f.hello));
		const next = f.bridge.pinReload(f.input)(),
			latest = f.request();
		f.peer.receive(
			JSON.stringify({ type: "reload-result", id: request.id, ok: true }),
		);
		peer.receive(
			JSON.stringify({ type: "reload-result", id: latest.id, ok: true }),
		);
		expect(await next).toEqual({ ok: true });
	} finally {
		f.bridge.dispose();
	}
});

test("journal acceptance failure releases the reserved reload slot without sending", async () => {
	const f = fixture(),
		db = new Database(":memory:");
	try {
		const full = new DirectOperationStore(db, "instance", 0);
		await expect(
			runBrowserReloadOperation(
				{ ...f.input, operationId: crypto.randomUUID() },
				{ operations: full, pin: (input) => f.bridge.pinReload(input) },
			),
		).rejects.toThrow("journal is full");
		expect(
			f.packets.filter((packet) => packet.type === "reload-request"),
		).toEqual([]);
		const newer = f.bridge.pinReload(f.input);
		newer.release?.();
		expect(full.activeCreateOperations).toBe(0);
	} finally {
		f.bridge.dispose();
		db.close();
	}
});

test("a lost peer acknowledgement leaves the original journal unresolved without a replay", async () => {
	const f = fixture(),
		db = new Database(":memory:");
	try {
		const operations = new DirectOperationStore(db, "instance"),
			operationId = crypto.randomUUID();
		const dependencies = {
			operations,
			pin: (input: typeof f.input) => f.bridge.pinReload(input),
		};
		const pending = runBrowserReloadOperation(
			{ ...f.input, operationId },
			dependencies,
		).catch((error) => error);
		await Promise.resolve();
		const original = f.request();
		f.peer.close();
		expect(await pending).toMatchObject({ kind: "unavailable" });
		expect(operations.status(operationId)?.status).toBe("unresolved");
		const newer = f.bridge.attach(f.transport);
		newer.receive(JSON.stringify(f.hello));
		await expect(
			runBrowserReloadOperation({ ...f.input, operationId }, dependencies),
		).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
		expect(
			f.packets.filter((packet) => packet.type === "reload-request"),
		).toEqual([original]);
	} finally {
		f.bridge.dispose();
		db.close();
	}
});

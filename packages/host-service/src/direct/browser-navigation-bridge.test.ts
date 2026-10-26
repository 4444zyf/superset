import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import type { BrowserBridgePacket } from "@superset/shared/browser-bridge";
import { DirectBrowserReadBridge } from "./browser-read-bridge";
import { DirectOperationStore } from "./operations";
import { runBrowserNavigationOperation } from "./browser-navigation-operation";

const identity = {
	backendId: "backend",
	namespaceId: "namespace",
	instanceId: "instance",
};
function fixture(features = ["readV1", "navigateV1"]) {
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
		url: "http://localhost:3000/中文",
	};
	const request = () => {
		const packet = packets.at(-1);
		if (!packet || packet.type !== "navigate-request")
			throw Error("No owned navigation request");
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

test("read peers cannot pin a navigation before negotiation", () => {
	const f = fixture(["readV1"]);
	try {
		expect(f.bridge.isNavigationReady()).toBe(false);
		expect(() => f.bridge.pinNavigation(f.input)).toThrow("unavailable");
		expect(f.packets).toHaveLength(1);
	} finally {
		f.bridge.dispose();
	}
});

test("pinning reserves the mutation slot without dispatch or a real timer", async () => {
	const f = fixture();
	try {
		const first = f.bridge.pinNavigation(f.input);
		expect(f.packets).toHaveLength(1);
		expect(f.tasks.size).toBe(0);
		expect(() => f.bridge.pinNavigation(f.input)).toThrow("already pending");
		const pending = first();
		expect(f.request()).toMatchObject({ type: "navigate-request", ...f.input });
		f.peer.receive(
			JSON.stringify({ type: "navigate-result", id: f.request().id, ok: true }),
		);
		expect(await pending).toEqual({ ok: true });
		expect(f.tasks.size).toBe(0);
		first.release?.();
		expect(f.bridge.isNavigationReady()).toBe(true);
	} finally {
		f.bridge.dispose();
	}
});

test("a pin from a closed peer cannot dispatch to its replacement", async () => {
	const f = fixture();
	try {
		const pinned = f.bridge.pinNavigation(f.input);
		f.peer.close();
		const newer = f.bridge.attach(f.transport);
		newer.receive(JSON.stringify(f.hello));
		await expect(pinned()).rejects.toMatchObject({ kind: "unavailable" });
		expect(
			f.packets.filter((packet) => packet.type === "navigate-request"),
		).toEqual([]);
		pinned.release?.();
		expect(f.bridge.isNavigationReady()).toBe(true);
	} finally {
		f.bridge.dispose();
	}
});

test("a completed navigation callback cannot issue a second request", async () => {
	const f = fixture();
	try {
		const pinned = f.bridge.pinNavigation(f.input),
			pending = pinned();
		f.peer.receive(
			JSON.stringify({ type: "navigate-result", id: f.request().id, ok: true }),
		);
		await pending;
		await expect(pinned()).rejects.toMatchObject({ kind: "unavailable" });
		expect(
			f.packets.filter((packet) => packet.type === "navigate-request"),
		).toHaveLength(1);
	} finally {
		f.bridge.dispose();
	}
});

test("a navigation timeout retires the peer and cannot bind its acknowledgement to a later peer", async () => {
	const f = fixture();
	try {
		const pending = f.bridge
				.pinNavigation(f.input)()
				.catch((error) => error),
			request = f.request();
		[...f.tasks][0]!();
		expect(await pending).toMatchObject({ kind: "timeout" });
		expect(f.bridge.isReady()).toBe(false);
		expect(f.closed).toEqual([1011]);
		const peer = f.bridge.attach(f.transport);
		peer.receive(JSON.stringify(f.hello));
		const next = f.bridge.pinNavigation(f.input)(),
			latest = f.request();
		f.peer.receive(
			JSON.stringify({ type: "navigate-result", id: request.id, ok: true }),
		);
		peer.receive(
			JSON.stringify({ type: "navigate-result", id: latest.id, ok: true }),
		);
		expect(await next).toEqual({ ok: true });
	} finally {
		f.bridge.dispose();
	}
});

test("journal acceptance failure releases the reserved navigation slot without sending", async () => {
	const f = fixture(),
		db = new Database(":memory:");
	try {
		const full = new DirectOperationStore(db, "instance", 0);
		await expect(
			runBrowserNavigationOperation(
				{ ...f.input, operationId: crypto.randomUUID() },
				{ operations: full, pin: (input) => f.bridge.pinNavigation(input) },
			),
		).rejects.toThrow("journal is full");
		expect(
			f.packets.filter((packet) => packet.type === "navigate-request"),
		).toEqual([]);
		const newer = f.bridge.pinNavigation(f.input);
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
			pin: (input: typeof f.input) => f.bridge.pinNavigation(input),
		};
		const pending = runBrowserNavigationOperation(
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
			runBrowserNavigationOperation({ ...f.input, operationId }, dependencies),
		).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
		expect(
			f.packets.filter((packet) => packet.type === "navigate-request"),
		).toEqual([original]);
	} finally {
		f.bridge.dispose();
		db.close();
	}
});

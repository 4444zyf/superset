import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import type { BrowserBridgePacket } from "@superset/shared/browser-bridge";
import { runBrowserCookieImportOperation } from "./browser-cookie-import-operation";
import { DirectBrowserReadBridge } from "./browser-read-bridge";
import { DirectOperationStore } from "./operations";

const identity = {
	backendId: "backend",
	namespaceId: "namespace",
	instanceId: "instance",
};
function fixture(features = ["readV1", "importCookiesV1"]) {
	const deadlines: number[] = [];
	const tasks = new Set<() => void>(),
		packets: BrowserBridgePacket[] = [],
		closed: number[] = [];
	const bridge = new DirectBrowserReadBridge(identity, {
		schedule: (_delay, callback) => {
			deadlines.push(_delay);
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
		sourceId: "/owned/配置/Default",
	};
	const request = () => {
		const packet = packets.at(-1);
		if (!packet || packet.type !== "import-cookies-request")
			throw Error("No owned cookie import request");
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
		deadlines,
	};
}

test("other browser features cannot enable cookie import before its own negotiation", () => {
	const f = fixture([
		"readV1",
		"navigateV1",
		"evaluateV1",
		"openV1",
		"reloadV1",
		"importSourcesV1",
	]);
	try {
		expect(f.bridge.isCookieImportReady()).toBe(false);
		expect(() => f.bridge.pinCookieImport(f.input)).toThrow("unavailable");
		expect(f.packets).toHaveLength(1);
	} finally {
		f.bridge.dispose();
	}
});

test("pinning reserves the mutation slot without dispatch or a real timer", async () => {
	const f = fixture();
	try {
		const first = f.bridge.pinCookieImport(f.input);
		expect(f.packets).toHaveLength(1);
		expect(f.tasks.size).toBe(0);
		expect(() => f.bridge.pinCookieImport(f.input)).toThrow("already pending");
		const pending = first();
		expect(f.deadlines.at(-1)).toBe(180_000);
		expect(f.request()).toMatchObject({
			type: "import-cookies-request",
			...f.input,
		});
		f.peer.receive(
			JSON.stringify({
				type: "import-cookies-result",
				id: f.request().id,
				ok: true,
				result: { imported: 2, skipped: 1, keyUnavailable: false },
			}),
		);
		expect(await pending).toEqual({
			imported: 2,
			skipped: 1,
			keyUnavailable: false,
		});
		expect(f.tasks.size).toBe(0);
		first.release?.();
		expect(f.bridge.isCookieImportReady()).toBe(true);
	} finally {
		f.bridge.dispose();
	}
});

test("a pin from a closed peer cannot dispatch to its replacement", async () => {
	const f = fixture();
	try {
		const pinned = f.bridge.pinCookieImport(f.input);
		f.peer.close();
		const newer = f.bridge.attach(f.transport);
		newer.receive(JSON.stringify(f.hello));
		await expect(pinned()).rejects.toMatchObject({ kind: "unavailable" });
		expect(
			f.packets.filter((packet) => packet.type === "import-cookies-request"),
		).toEqual([]);
		pinned.release?.();
		expect(f.bridge.isCookieImportReady()).toBe(true);
	} finally {
		f.bridge.dispose();
	}
});

test("a completed cookie import callback cannot issue a second request", async () => {
	const f = fixture();
	try {
		const pinned = f.bridge.pinCookieImport(f.input),
			pending = pinned();
		f.peer.receive(
			JSON.stringify({
				type: "import-cookies-result",
				id: f.request().id,
				ok: true,
				result: { imported: 2, skipped: 1, keyUnavailable: false },
			}),
		);
		await pending;
		await expect(pinned()).rejects.toMatchObject({ kind: "unavailable" });
		expect(
			f.packets.filter((packet) => packet.type === "import-cookies-request"),
		).toHaveLength(1);
	} finally {
		f.bridge.dispose();
	}
});

test("a cookie import timeout retires the peer and cannot bind its acknowledgement to a later peer", async () => {
	const f = fixture();
	try {
		const pending = f.bridge
				.pinCookieImport(f.input)()
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
		const next = f.bridge.pinCookieImport(f.input)(),
			latest = f.request();
		f.peer.receive(
			JSON.stringify({
				type: "import-cookies-result",
				id: request.id,
				ok: true,
				result: { imported: 2, skipped: 1, keyUnavailable: false },
			}),
		);
		peer.receive(
			JSON.stringify({
				type: "import-cookies-result",
				id: latest.id,
				ok: true,
				result: { imported: 2, skipped: 1, keyUnavailable: false },
			}),
		);
		expect(await next).toEqual({
			imported: 2,
			skipped: 1,
			keyUnavailable: false,
		});
	} finally {
		f.bridge.dispose();
	}
});

test("journal acceptance failure releases the reserved cookie import slot without sending", async () => {
	const f = fixture(),
		db = new Database(":memory:");
	try {
		const full = new DirectOperationStore(db, "instance", 0);
		await expect(
			runBrowserCookieImportOperation(
				{ ...f.input, operationId: crypto.randomUUID() },
				{ operations: full, pin: (input) => f.bridge.pinCookieImport(input) },
			),
		).rejects.toThrow("journal is full");
		expect(
			f.packets.filter((packet) => packet.type === "import-cookies-request"),
		).toEqual([]);
		const newer = f.bridge.pinCookieImport(f.input);
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
			pin: (input: typeof f.input) => f.bridge.pinCookieImport(input),
		};
		const pending = runBrowserCookieImportOperation(
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
			runBrowserCookieImportOperation(
				{ ...f.input, operationId },
				dependencies,
			),
		).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
		expect(
			f.packets.filter((packet) => packet.type === "import-cookies-request"),
		).toEqual([original]);
	} finally {
		f.bridge.dispose();
		db.close();
	}
});

test("a busy session acknowledgement remains a non-dispatched explicit failure without a retry", async () => {
	const f = fixture();
	try {
		const pinned = f.bridge.pinCookieImport(f.input),
			pending = pinned().catch((error) => error);
		f.peer.receive(
			JSON.stringify({
				type: "import-cookies-result",
				id: f.request().id,
				ok: false,
				error: { kind: "busy", message: "Owned session import pending" },
			}),
		);
		expect(await pending).toMatchObject({ kind: "busy" });
		expect(f.tasks.size).toBe(0);
		expect(f.bridge.isCookieImportReady()).toBe(true);
		expect(
			f.packets.filter((packet) => packet.type === "import-cookies-request"),
		).toHaveLength(1);
		pinned.release?.();
	} finally {
		f.bridge.dispose();
	}
});

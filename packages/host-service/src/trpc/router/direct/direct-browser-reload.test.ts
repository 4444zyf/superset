import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { DirectBrowserReadBridge } from "../../../direct/browser-read-bridge";
import { DirectOperationStore } from "../../../direct/operations";
import type { HostServiceContext } from "../../../types";
import { router } from "../../index";
import { describeDirectBackend, directRouter } from "./direct";

const rootRouter = router({ direct: directRouter });
const identity = {
	backendId: "backend",
	namespaceId: "namespace",
	instanceId: "instance",
	serviceUid: 1000,
};
function fixture(features = ["readV1", "reloadV1"], capacity?: number) {
	const db = new Database(":memory:");
	const operations = new DirectOperationStore(db, "instance", capacity);
	const tasks = new Set<() => void>(),
		sent: unknown[] = [],
		requested = Promise.withResolvers<void>();
	let hold = false;
	const bridge = new DirectBrowserReadBridge(identity, {
		schedule: (_delay, callback) => {
			tasks.add(callback);
			return () => {
				tasks.delete(callback);
			};
		},
	});
	const peer = bridge.attach({
		send: (raw) => {
			const packet = JSON.parse(raw);
			if (packet.type !== "reload-request") return;
			sent.push(packet);
			requested.resolve();
			if (!hold)
				peer.receive(
					JSON.stringify({
						type: "reload-result",
						id: packet.id,
						ok: true,
					}),
				);
		},
		close: () => {},
	});
	peer.receive(
		JSON.stringify({ type: "hello", protocol: 1, ...identity, features }),
	);
	const input = {
		operationId: crypto.randomUUID(),
		workspaceId: "owned",
		paneId: "page",
		hard: false,
	};
	const caller = (override: Partial<HostServiceContext> = {}) =>
		rootRouter.createCaller({
			direct: identity,
			directOperations: operations,
			directBrowserReads: bridge,
			isAuthenticated: true,
			...override,
		} as HostServiceContext).direct;
	return {
		db,
		bridge,
		operations,
		tasks,
		sent,
		requested,
		input,
		caller,
		peer,
		hold: () => {
			hold = true;
		},
		close: () => {
			bridge.dispose();
			db.close();
		},
	};
}

test("the versioned reload mutation completes its durable receipt and repeated IDs do not dispatch again", async () => {
	const f = fixture();
	try {
		const receipt = await f.caller().browserReloadV1(f.input);
		expect(receipt).toMatchObject({
			status: "completed",
			operationId: f.input.operationId,
			result: { ok: true },
		});
		expect(await f.caller().browserReloadV1(f.input)).toEqual(receipt);
		expect(f.sent).toHaveLength(1);
		expect(f.sent[0]).toMatchObject({
			workspaceId: "owned",
			paneId: "page",
			hard: f.input.hard,
		});
	} finally {
		f.close();
	}
});

test("reload requires original auth, durable storage and negotiated peer support before acceptance", async () => {
	const f = fixture(["readV1"]);
	try {
		await expect(
			f.caller({ isAuthenticated: false }).browserReloadV1(f.input),
		).rejects.toMatchObject({ code: "UNAUTHORIZED" });
		await expect(
			f.caller({ directOperations: undefined }).browserReloadV1(f.input),
		).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
		await expect(f.caller().browserReloadV1(f.input)).rejects.toMatchObject({
			code: "PRECONDITION_FAILED",
		});
		expect(f.operations.status(f.input.operationId)).toBe(null);
		expect(f.sent).toEqual([]);
		expect(
			describeDirectBackend(identity, true, false, f.bridge).capabilities
				.workstationBrowserReloadV1,
		).toBe(false);
	} finally {
		f.close();
	}
});

test("strict reload input cannot add a navigation payload or omit the stable operation ID", async () => {
	const f = fixture();
	try {
		await expect(
			f.caller().browserReloadV1({
				...f.input,
				url: "https://extra.invalid",
			} as never),
		).rejects.toMatchObject({ code: "BAD_REQUEST" });
		await expect(
			f.caller().browserReloadV1({
				workspaceId: "owned",
				paneId: "page",
				hard: f.input.hard,
			} as never),
		).rejects.toMatchObject({ code: "BAD_REQUEST" });
		await expect(
			f.caller().browserReloadV1({ ...f.input, hard: "false" as never }),
		).rejects.toMatchObject({ code: "BAD_REQUEST" });
		expect(f.sent).toEqual([]);
		expect(f.operations.status(f.input.operationId)).toBe(null);
	} finally {
		f.close();
	}
});

test("an reload disconnect is unresolved with a non-internal error and cannot be replayed", async () => {
	const f = fixture();
	try {
		f.hold();
		const pending = f
			.caller()
			.browserReloadV1(f.input)
			.catch((error) => error);
		await Promise.race([
			f.requested.promise,
			pending.then(() => {
				throw Error("Reload settled before its request was dispatched");
			}),
		]);
		f.peer.close();
		expect(await pending).toMatchObject({ code: "PRECONDITION_FAILED" });
		expect(f.operations.status(f.input.operationId)).toMatchObject({
			status: "unresolved",
			error: { code: "PRECONDITION_FAILED" },
		});
		await expect(f.caller().browserReloadV1(f.input)).rejects.toMatchObject({
			code: "PRECONDITION_FAILED",
		});
		expect(f.sent).toHaveLength(1);
	} finally {
		f.close();
	}
});

test("a completed reload remains readable without the peer or during maintenance", async () => {
	const f = fixture();
	try {
		expect(
			describeDirectBackend(identity, true, false, f.bridge).capabilities
				.workstationBrowserReloadV1,
		).toBe(true);
		expect(
			describeDirectBackend(identity, false, false, f.bridge).capabilities
				.workstationBrowserReloadV1,
		).toBe(false);
		const receipt = await f.caller().browserReloadV1(f.input);
		f.peer.close();
		f.operations.beginDrain(crypto.randomUUID(), true);
		expect(await f.caller().browserReloadV1(f.input)).toEqual(receipt);
		expect(
			await f.caller().operationStatus({ operationId: f.input.operationId }),
		).toEqual(receipt);
		expect(f.sent).toHaveLength(1);
	} finally {
		f.close();
	}
});

test("a full journal rejects reload without occupying its peer reservation", async () => {
	const f = fixture(undefined, 0);
	try {
		await expect(f.caller().browserReloadV1(f.input)).rejects.toMatchObject({
			code: "PRECONDITION_FAILED",
		});
		const pin = f.bridge.pinReload({
			workspaceId: "owned",
			paneId: "page",
			hard: f.input.hard,
		});
		pin.release?.();
		expect(f.sent).toEqual([]);
		expect(f.operations.status(f.input.operationId)).toBe(null);
	} finally {
		f.close();
	}
});

import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import type { HostDb } from "../../../db";
import * as schema from "../../../db/schema";
import { workspaces } from "../../../db/schema";
import { DirectOperationStore } from "../../../direct/operations";
import { DirectBrowserReadBridge } from "../../../direct/browser-read-bridge";
import type { HostServiceContext } from "../../../types";
import { router } from "../../index";
import { directRouter, describeDirectBackend } from "./direct";
const root = router({ direct: directRouter }),
	identity = {
		backendId: "backend",
		namespaceId: "namespace",
		instanceId: "instance",
		serviceUid: 1000,
	};
function fixture(ready = true, capacity?: number) {
	const sqlite = new Database(":memory:");
	const raw = drizzle(sqlite, { schema });
	migrate(raw, {
		migrationsFolder: resolve(import.meta.dir, "../../../../drizzle"),
	});
	const db = raw as unknown as HostDb;
	db.insert(workspaces)
		.values({
			id: "owned",
			projectId: null,
			type: "local",
			name: "Owned 工作区",
			worktreePath: "/owned",
			branch: "main",
		})
		.run();
	const operations = new DirectOperationStore(sqlite, "instance", capacity),
		sent: Array<Record<string, unknown>> = [],
		tasks = new Set<() => void>();
	let hold = false;
	const requested = Promise.withResolvers<void>();
	const bridge = new DirectBrowserReadBridge(identity, {
		schedule: (_ms, cb) => {
			tasks.add(cb);
			return () => {
				tasks.delete(cb);
			};
		},
	});
	const scopeId = crypto.randomUUID();
	const peer = bridge.attach({
		send: (raw) => {
			const packet = JSON.parse(raw);
			if (packet.type !== "open-request") return;
			sent.push(packet);
			requested.resolve();
			if (!hold)
				peer.receive(
					JSON.stringify({
						type: "open-result",
						id: packet.id,
						scopeId: packet.scopeId,
						ok: true,
						result: {
							paneId: "created-pane",
							url: "http://localhost:3000/中文",
							title: "",
						},
					}),
				);
		},
		close: () => {},
	});
	peer.receive(
		JSON.stringify({
			type: "hello",
			protocol: 1,
			...identity,
			features: ["readV1", "openV1"],
		}),
	);
	if (ready)
		peer.receive(
			JSON.stringify({
				type: "open-availability",
				scopeId,
				ready: true,
				accepting: true,
			}),
		);
	const input = {
		operationId: crypto.randomUUID(),
		workspaceId: "owned",
		url: "localhost:3000/中文",
	};
	const caller = (override: Partial<HostServiceContext> = {}) =>
		root.createCaller({
			db,
			direct: identity,
			directOperations: operations,
			directBrowserReads: bridge,
			isAuthenticated: true,
			...override,
		} as HostServiceContext).direct;
	return {
		sqlite,
		db,
		operations,
		bridge,
		peer,
		input,
		sent,
		scopeId,
		caller,
		requested,
		hold: () => {
			hold = true;
		},
		close: () => {
			bridge.dispose();
			sqlite.close();
		},
	};
}

test("browser open derives real projectless workspace metadata and records one completed pane", async () => {
	const f = fixture();
	try {
		const receipt = await f.caller().browserOpenV1(f.input);
		expect(receipt).toMatchObject({
			operationId: f.input.operationId,
			status: "completed",
			result: {
				paneId: "created-pane",
				url: "http://localhost:3000/中文",
				title: "",
			},
		});
		expect(f.sent[0]).toMatchObject({
			workspaceId: "owned",
			projectId: null,
			workspaceName: "Owned 工作区",
			target: "current-tab",
			show: false,
			scopeId: f.scopeId,
		});
		expect(
			await f
				.caller()
				.browserOpenV1({ ...f.input, target: "current-tab", show: false }),
		).toEqual(receipt);
		expect(f.sent).toHaveLength(1);
	} finally {
		f.close();
	}
});

test("open validates original auth, durable storage, renderer readiness and actual workspace before acceptance", async () => {
	const f = fixture(false);
	try {
		await expect(
			f.caller({ isAuthenticated: false }).browserOpenV1(f.input),
		).rejects.toMatchObject({ code: "UNAUTHORIZED" });
		await expect(
			f.caller({ directOperations: undefined }).browserOpenV1(f.input),
		).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
		await expect(f.caller().browserOpenV1(f.input)).rejects.toMatchObject({
			code: "PRECONDITION_FAILED",
		});
		expect(f.operations.status(f.input.operationId)).toBe(null);
		expect(
			describeDirectBackend(identity, true, false, f.bridge).capabilities
				.workstationBrowserOpenV1,
		).toBe(false);
	} finally {
		f.close();
	}
	const ready = fixture();
	try {
		const input = { ...ready.input, workspaceId: "missing" };
		await expect(ready.caller().browserOpenV1(input)).rejects.toMatchObject({
			code: "NOT_FOUND",
		});
		expect(ready.operations.status(input.operationId)).toBe(null);
		expect(ready.sent).toEqual([]);
	} finally {
		ready.close();
	}
});

test("open rejects client metadata injection and conflicting show intent", async () => {
	const f = fixture();
	try {
		await expect(
			f.caller().browserOpenV1({ ...f.input, projectId: "forged" } as never),
		).rejects.toMatchObject({ code: "BAD_REQUEST" });
		await f.caller().browserOpenV1(f.input);
		await expect(
			f.caller().browserOpenV1({ ...f.input, show: true }),
		).rejects.toMatchObject({ code: "CONFLICT" });
		expect(f.sent).toHaveLength(1);
	} finally {
		f.close();
	}
});

test("completed opens remain readable after workspace deletion, peer closure and maintenance", async () => {
	const f = fixture();
	try {
		const receipt = await f.caller().browserOpenV1(f.input);
		f.db.delete(workspaces).run();
		f.peer.close();
		f.operations.beginDrain(crypto.randomUUID(), true);
		expect(
			await f
				.caller({ db: undefined, directBrowserReads: undefined })
				.browserOpenV1(f.input),
		).toEqual(receipt);
		expect(
			await f.caller().operationStatus({ operationId: f.input.operationId }),
		).toEqual(receipt);
		expect(f.sent).toHaveLength(1);
	} finally {
		f.close();
	}
});

test("a changed view scope leaves an accepted open unresolved without replay", async () => {
	const f = fixture();
	try {
		f.hold();
		const pending = f
			.caller()
			.browserOpenV1(f.input)
			.catch((error) => error);
		await Promise.race([
			f.requested.promise,
			pending.then(() => {
				throw Error("Open settled without dispatch");
			}),
		]);
		f.peer.receive(
			JSON.stringify({
				type: "open-availability",
				scopeId: crypto.randomUUID(),
				ready: true,
				accepting: true,
			}),
		);
		expect(await pending).toMatchObject({ code: "PRECONDITION_FAILED" });
		expect(f.operations.status(f.input.operationId)?.status).toBe("unresolved");
		await expect(f.caller().browserOpenV1(f.input)).rejects.toMatchObject({
			code: "PRECONDITION_FAILED",
		});
		expect(f.sent).toHaveLength(1);
	} finally {
		f.close();
	}
});

test("a full journal releases the peer reservation without dispatching an open", async () => {
	const f = fixture(true, 0);
	try {
		await expect(f.caller().browserOpenV1(f.input)).rejects.toMatchObject({
			code: "PRECONDITION_FAILED",
		});
		expect(f.sent).toEqual([]);
		expect(f.operations.status(f.input.operationId)).toBe(null);
		const pinned = f.bridge.pinOpen({
			workspaceId: "owned",
			projectId: null,
			workspaceName: "Owned",
			url: f.input.url,
			target: "current-tab",
			show: false,
		});
		pinned.release?.();
		expect(f.operations.activeCreateOperations).toBe(0);
	} finally {
		f.close();
	}
});

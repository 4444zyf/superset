import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import {
	ConnectionRegistry,
	LOCAL_CONNECTION_ID,
} from "@superset/direct-connection";
import { WorkspaceRestoreCoordinator } from "./workspace-restore-coordinator";
import { WorkspaceViewStore } from "./workspace-view-store";

function fixture() {
	const registry = new ConnectionRegistry(new Database(":memory:")),
		store = new WorkspaceViewStore(new Database(":memory:"));
	const id = LOCAL_CONNECTION_ID,
		calls: string[] = [];
	const identities = {
		a: { backendId: randomUUID(), namespaceId: randomUUID() },
		b: { backendId: randomUUID(), namespaceId: randomUUID() },
	};
	const pin = (tag: "a" | "b") =>
		registry.save({
			id,
			kind: "local",
			host: "localhost",
			name: "Local",
			...identities[tag],
			serviceUid: 1000,
		});
	pin("a");
	let generation = 1;
	const descriptor = () => {
		const p = registry.get(id)!;
		return {
			connectionId: id,
			generation,
			backendId: p.backendId!,
			namespaceId: p.namespaceId!,
			instanceId: "running-instance",
			capabilities: { workspaceViewRestoreV1: true },
			url: "http://127.0.0.1:1",
		};
	};
	const coordinator = new WorkspaceRestoreCoordinator({
		store,
		registry,
		window: () => ({ x: 0, y: 0, width: 1200, height: 900, maximized: false }),
		notify: () => {},
		manager: {
			getLease: () => descriptor(),
			getStatus: () => ({ generation, state: "ready" }),
			disconnect: () => {
				generation++;
			},
			connect: async (_id, options) => {
				calls.push(options.mode);
				return descriptor();
			},
		},
		controller: {
			describe: descriptor,
			features: async () => ({
				capabilities: { workspaceViewRestoreV1: true },
			}),
			inspectPending: async () => [],
			invoke: async (request) =>
				(request.input as { refs: unknown[] }).refs.map((ref) => ({
					...(ref as object),
					state: "live",
				})),
		},
	});
	coordinator.activateOwner(1);
	const input = () => {
		const {
			schemaVersion: _,
			revision: __,
			updatedAt: ___,
			...v
		} = store.read().snapshot!;
		return v;
	};
	async function addWorkspace(label: string) {
		const v = input(),
			target = v.targets.find((t) => t.connectionId === id)!;
		target.activeTabId = "tab";
		target.workspaces = [
			{
				tabId: "tab",
				workspaceId: "workspace",
				label,
				activeTool: "terminal",
				activePaneId: "pane",
				panes: [
					{
						paneId: "pane",
						kind: "terminal",
						resourceId: "terminal",
						executionId: `execution-${label}`,
					},
				],
				layout: { type: "pane", paneId: "pane" },
			},
		];
		await coordinator.save(1, {
			expectedRevision: store.read().revision,
			navigationRevision: 0,
			view: v,
		});
	}
	return {
		id,
		store,
		coordinator,
		calls,
		pin,
		input,
		addWorkspace,
		close() {
			coordinator.activateOwner(null);
			store.close();
			registry.close();
		},
	};
}

test("local workspace view survives renderer ownership changes and restores only existing executions", async () => {
	const f = fixture();
	try {
		await f.coordinator.recordConnect(f.id);
		await f.addWorkspace("a");
		f.coordinator.activateOwner(2);
		expect(f.store.read().snapshot?.targets[0]?.workspaces[0]?.label).toBe("a");
		f.coordinator.begin(2, { reason: "launch", navigationRevision: 0 });
		await f.coordinator.idle();
		expect(f.coordinator.get()?.status).toBe("ready");
		expect(f.calls).toEqual(["restore-existing"]);
		expect(f.coordinator.get()?.resources[0]).toMatchObject({
			resourceId: "terminal",
			executionId: "execution-a",
			state: "live",
		});
	} finally {
		f.close();
	}
});

test("namespace A to B to A preserves both views and rejects a queued stale save", async () => {
	const f = fixture();
	try {
		await f.coordinator.recordConnect(f.id);
		await f.addWorkspace("a");
		const a = f.input();
		const pending = f.coordinator.save(1, {
			expectedRevision: f.store.read().revision,
			navigationRevision: 0,
			view: a,
		});
		f.pin("b");
		f.coordinator.selectLocalNamespace(f.id);
		await expect(pending).rejects.toThrow();
		expect(f.store.read().snapshot?.targets).toEqual([]);
		await f.coordinator.recordConnect(f.id);
		await f.addWorkspace("b");
		const b = f.input();
		f.pin("a");
		f.coordinator.selectLocalNamespace(f.id);
		expect(f.store.read().snapshot?.targets[0]?.workspaces[0]?.label).toBe("a");
		expect(f.store.read().snapshot?.targets[0]?.autoConnect).toBe(false);
		f.coordinator.begin(1, { reason: "launch", navigationRevision: 0 });
		expect(f.coordinator.get()?.status).toBe("paused");
		expect(f.calls).toEqual([]);
		await expect(
			f.coordinator.save(1, {
				expectedRevision: f.store.read().revision,
				navigationRevision: 0,
				view: b,
			}),
		).rejects.toThrow("identity");
		await f.coordinator.recordConnect(f.id);
		f.coordinator.begin(1, { reason: "manual", navigationRevision: 0 });
		await f.coordinator.idle();
		expect(f.coordinator.get()?.status).toBe("ready");
		expect(f.store.read().snapshot?.targets[0]?.workspaces[0]?.label).toBe("a");
	} finally {
		f.close();
	}
});

import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import {
	DirectConnectionError,
	ConnectionRegistry,
} from "@superset/direct-connection";
import { WorkspaceViewStore } from "./workspace-view-store";
import { WorkspaceRestoreCoordinator } from "./workspace-restore-coordinator";

function fixture(options: { wait?: (ms: number) => Promise<void> } = {}) {
	const registry = new ConnectionRegistry(new Database(":memory:"));
	const profile = registry.save({
		id: "mac",
		name: "Mac",
		host: "mini",
		backendId: "5b2ea852-8428-4a22-91e6-980f81432131",
		namespaceId: "18817038-3f91-4c8c-99e5-7267c6398f0a",
		serviceUid: 501,
	});
	const store = new WorkspaceViewStore(new Database(":memory:"));
	const calls: string[] = [];
	let generation = 0;
	let connected = false;
	const finishes: (() => void)[] = [];
	const manager = {
		getLease: () =>
			connected
				? {
						connectionId: "mac",
						generation,
						backendId: profile.backendId!,
						namespaceId: profile.namespaceId!,
						instanceId: "new-host-instance",
						url: "http://127.0.0.1:12345",
					}
				: null,
		getStatus: () => ({
			generation,
			state: connected ? "ready" : "disconnected",
		}),
		connect: async (_id: string, options: { mode: string }) => {
			generation++;
			calls.push(options.mode);
			await new Promise<void>((resolve) => {
				finishes.push(resolve);
			});
			connected = true;
			return manager.getLease()!;
		},
		disconnect: () => {
			generation++;
			connected = false;
			calls.push("disconnect");
		},
	};
	const controller = {
		describe: () => manager.getLease()!,
		features: async () => ({ capabilities: { workspaceViewRestoreV1: true } }),
		invoke: async () => [],
		inspectPending: async () => {
			calls.push("inspect");
			return [];
		},
	};
	const coordinator = new WorkspaceRestoreCoordinator({
		store,
		registry,
		manager,
		controller,
		window: () => ({ x: 0, y: 0, width: 1280, height: 850, maximized: false }),
		notify: () => {},
		...options,
	});
	coordinator.activateOwner(1);
	store.save({
		owner: "1",
		expectedRevision: 0,
		view: {
			restoreOnLaunch: true,
			activeConnectionId: "mac",
			targets: [
				{
					connectionId: "mac",
					targetRevision: 1,
					backendId: profile.backendId,
					namespaceId: profile.namespaceId,
					serviceUid: 501,
					autoConnect: true,
					activeTabId: null,
					workspaces: [],
				},
			],
			window: { x: 0, y: 0, width: 1280, height: 850, maximized: false },
		},
	});
	return {
		store,
		registry,
		coordinator,
		calls,
		manager,
		finish: () => {
			for (const resolve of finishes.splice(0)) resolve();
		},
		close: () => {
			coordinator.activateOwner(null);
			store.close();
			registry.close();
		},
	};
}

test("an explicit disconnect disables startup connection while keeping the layout", async () => {
	const f = fixture();
	try {
		await f.coordinator.recordDisconnect("mac");
		f.coordinator.begin(1, { reason: "launch", navigationRevision: 0 });
		await f.coordinator.idle();
		expect(f.calls).toEqual([]);
		expect(f.store.read().snapshot?.targets[0]?.autoConnect).toBe(false);
		expect(f.coordinator.get()?.status).toBe("paused");
	} finally {
		f.close();
	}
});

test("duplicate startup requests share one existing-only connection and never install", async () => {
	const f = fixture();
	try {
		const first = f.coordinator.begin(1, {
			reason: "launch",
			navigationRevision: 0,
		});
		const second = f.coordinator.begin(1, {
			reason: "launch",
			navigationRevision: 0,
		});
		expect(second.jobId).toBe(first.jobId);
		await Promise.resolve();
		f.finish();
		await f.coordinator.idle();
		expect(f.calls).toEqual(["restore-existing", "inspect"]);
		expect(f.coordinator.get()?.status).toBe("ready");
	} finally {
		f.close();
	}
});

test("a cancelled late restore cannot disconnect a newer user connection", async () => {
	const f = fixture();
	try {
		const job = f.coordinator.begin(1, {
			reason: "launch",
			navigationRevision: 0,
		});
		await Promise.resolve();
		f.coordinator.cancel(1, job.jobId);
		const newer = f.manager.connect("mac", { mode: "explicit" });
		f.finish();
		await newer;
		await f.coordinator.idle();
		expect(f.manager.getLease()).not.toBeNull();
		expect(f.coordinator.get()?.status).toBe("cancelled");
	} finally {
		f.close();
	}
});

test("a disconnected renderer cannot invent a terminal reference or override trusted identity", async () => {
	const f = fixture();
	try {
		const saved = f.store.read().snapshot!;
		const { revision: _, schemaVersion: __, updatedAt: ___, ...view } = saved;
		view.targets[0]!.workspaces.push({
			tabId: "tab",
			workspaceId: "workspace",
			activeTool: "terminal",
			activePaneId: "pane",
			panes: [
				{
					paneId: "pane",
					kind: "terminal",
					resourceId: "invented",
					executionId: "invented",
				},
			],
			layout: { type: "pane", paneId: "pane" },
		});
		view.targets[0]!.activeTabId = "tab";
		await expect(
			f.coordinator.save(1, {
				expectedRevision: 1,
				navigationRevision: 0,
				view,
			}),
		).rejects.toThrow("authenticated");
		expect(f.store.read().snapshot?.revision).toBe(1);
	} finally {
		f.close();
	}
});

test("a renderer reload invalidates queued writes even when its webContents owner ID is unchanged", async () => {
	const f = fixture();
	try {
		const pending = f.coordinator.updateWindow({
			x: 999,
			y: 0,
			width: 1280,
			height: 850,
			maximized: false,
		});
		f.coordinator.activateOwner(1);
		await expect(pending).rejects.toThrow("owner");
		expect(f.store.read().snapshot?.window.x).toBe(0);
	} finally {
		f.close();
	}
});

test("startup retries only retryable transport failures with bounded existing-only attempts", async () => {
	const delays: number[] = [];
	const f = fixture({
		wait: async (ms) => {
			delays.push(ms);
		},
	});
	let attempts = 0;
	f.manager.connect = async (_id, options) => {
		f.calls.push(options.mode);
		attempts++;
		throw new DirectConnectionError("network offline", true);
	};
	try {
		f.coordinator.begin(1, { reason: "launch", navigationRevision: 0 });
		await f.coordinator.idle();
		expect(delays).toEqual([1000, 2000, 4000]);
		expect(attempts).toBe(4);
		expect(f.calls.filter((c) => c === "restore-existing")).toHaveLength(4);
		expect(f.coordinator.get()?.status).toBe("paused");
	} finally {
		f.close();
	}
});

test("editing the SSH target pauses restoration without connecting or replacing the old view", async () => {
	const f = fixture();
	try {
		const before = f.store.read().snapshot;
		f.registry.save({ ...f.registry.get("mac")!, host: "different-machine" });
		f.coordinator.begin(1, { reason: "launch", navigationRevision: 0 });
		await f.coordinator.idle();
		expect(f.calls).toEqual([]);
		expect(f.coordinator.get()).toMatchObject({
			status: "paused",
			reason: "target-changed",
		});
		expect(f.store.read().snapshot).toEqual(before);
	} finally {
		f.close();
	}
});

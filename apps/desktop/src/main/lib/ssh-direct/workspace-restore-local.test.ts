import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import type { DirectRpc } from "../../../shared/direct-workstation";
import type { WorkspaceViewInputV2 } from "../../../shared/workspace-view-v2";
import {
	ConnectionRegistry,
	LOCAL_CONNECTION_ID,
} from "@superset/direct-connection";
import {
	WorkstationBrowserOpenRequests,
	type WorkstationBrowserOpenEvent,
} from "./workstation-browser-open-requests";
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
	const requests: DirectRpc[] = [];
	let workspaceCheck: () => Promise<unknown> = async () => ({
		id: "workspace",
	});
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
			invoke: async (request) => {
				requests.push(request);
				if (request.path === "workspace.get") return workspaceCheck();
				return (request.input as { refs: object[] }).refs.map((ref) => ({
					...ref,
					state: "live",
				}));
			},
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
		descriptor,
		requests,
		setWorkspaceCheck(check: () => Promise<unknown>) {
			workspaceCheck = check;
		},
		advanceGeneration() {
			generation++;
		},
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

function browserInput(f: ReturnType<typeof fixture>): WorkspaceViewInputV2 {
	const view: WorkspaceViewInputV2 = f.input();
	const workspace = view.targets[0]?.workspaces[0];
	if (!workspace?.layout) throw new Error("Missing fixture workspace");
	workspace.panes.push({
		paneId: "browser",
		kind: "browser",
		resourceId: "browser",
		browser: { url: "about:blank", pageTitle: "Browser", faviconUrl: null },
	});
	workspace.layout = {
		type: "split",
		axis: "horizontal",
		ratio: 0.4,
		first: workspace.layout,
		second: { type: "pane", paneId: "browser" },
	};
	workspace.activePaneId = "browser";
	return view;
}

async function seedTerminal(f: ReturnType<typeof fixture>) {
	await f.coordinator.recordConnect(f.id);
	await f.addWorkspace("a");
	f.requests.length = 0;
}

function saveBrowser(f: ReturnType<typeof fixture>, view = browserInput(f)) {
	return f.coordinator.saveV2(1, {
		expectedRevision: f.store.read().revision,
		navigationRevision: 0,
		view,
		browserLeases: [
			{ connectionId: f.id, generation: f.descriptor().generation },
		],
	});
}

test("V2 browser saves validate the workspace and restore only original terminal executions", async () => {
	const f = fixture();
	try {
		await seedTerminal(f);
		await saveBrowser(f);
		expect(f.requests.map((request) => [request.path, request.input])).toEqual([
			["workspace.get", { id: "workspace" }],
		]);
		expect(
			f.store
				.readV2()
				.snapshot?.targets[0]?.workspaces[0]?.panes.map((pane) => pane.kind),
		).toEqual(["terminal", "browser"]);
		f.requests.length = 0;
		f.coordinator.activateOwner(2);
		f.coordinator.begin(2, { reason: "launch", navigationRevision: 0 });
		await f.coordinator.idle();
		expect(f.coordinator.get()?.status).toBe("ready");
		expect(
			f.requests
				.filter((request) => request.path === "workspace.restoreResources")
				.map((request) => request.input),
		).toEqual([
			{
				refs: [
					{
						workspaceId: "workspace",
						kind: "terminal",
						resourceId: "terminal",
						executionId: "execution-a",
					},
				],
			},
		]);
		expect(
			f.store.readV2().snapshot?.targets[0]?.workspaces[0]?.activePaneId,
		).toBe("browser");
	} finally {
		f.close();
	}
});

test("new browser pages require a matching current generation binding", async () => {
	const f = fixture();
	try {
		await seedTerminal(f);
		const before = f.store.readV2();
		for (const browserLeases of [
			undefined,
			[{ connectionId: f.id, generation: 99 }],
		]) {
			await expect(
				f.coordinator.saveV2(1, {
					expectedRevision: before.revision,
					navigationRevision: 0,
					view: browserInput(f),
					browserLeases,
				}),
			).rejects.toThrow("generation");
		}
		expect(f.requests).toEqual([]);
		expect(f.store.readV2()).toEqual(before);
	} finally {
		f.close();
	}
});

test("a late browser workspace check cannot save into a new connection generation", async () => {
	const f = fixture();
	try {
		await seedTerminal(f);
		const before = f.store.readV2();
		const check = Promise.withResolvers<unknown>(),
			started = Promise.withResolvers<void>();
		f.setWorkspaceCheck(() => {
			started.resolve();
			return check.promise;
		});
		const pending = saveBrowser(f);
		await started.promise;
		f.advanceGeneration();
		check.resolve({ id: "workspace" });
		await expect(pending).rejects.toThrow("generation");
		expect(f.store.readV2()).toEqual(before);
	} finally {
		f.close();
	}
});

test("a late browser workspace check cannot save after renderer ownership changes", async () => {
	const f = fixture();
	try {
		await seedTerminal(f);
		const before = f.store.readV2();
		const check = Promise.withResolvers<unknown>(),
			started = Promise.withResolvers<void>();
		f.setWorkspaceCheck(() => {
			started.resolve();
			return check.promise;
		});
		const pending = saveBrowser(f);
		await started.promise;
		f.coordinator.activateOwner(2);
		check.resolve({ id: "workspace" });
		await expect(pending).rejects.toThrow("owner");
		expect(f.store.readV2()).toEqual(before);
	} finally {
		f.close();
	}
});

test("generic V2 layout saves cannot overwrite live browser page metadata", async () => {
	const f = fixture();
	try {
		await seedTerminal(f);
		await saveBrowser(f);
		const before = f.store.readV2();
		const saved = before.snapshot;
		if (!saved) throw new Error("Missing fixture snapshot");
		const {
			schemaVersion: _,
			revision: __,
			updatedAt: ___,
			...view
		} = structuredClone(saved);
		const pane = view.targets[0]?.workspaces[0]?.panes.find(
			(item) => item.kind === "browser",
		);
		if (!pane || pane.kind !== "browser")
			throw new Error("Missing fixture browser");
		pane.browser.pageTitle = "Old page result";
		await expect(saveBrowser(f, view)).rejects.toThrow("active registration");
		expect(f.store.readV2()).toEqual(before);
	} finally {
		f.close();
	}
});

test("registered browser metadata updates preserve terminal layout and stale callbacks do not write", async () => {
	const f = fixture();
	try {
		await seedTerminal(f);
		await saveBrowser(f);
		const descriptor = f.descriptor();
		const pane = {
			connectionId: f.id,
			generation: descriptor.generation,
			workspaceId: "workspace",
			paneId: "browser",
			registrationId: "2af9d874-b03f-44e2-a4dd-3215739613ea",
		};
		const state = {
			url: "https://example.com/next",
			pageTitle: "页面 🙂",
			faviconUrl: null,
		};
		const before = f.store.readV2();
		expect(
			await f.coordinator.updateBrowserPage(
				1,
				{ pane, resourceId: "browser", state },
				() => null,
			),
		).toEqual({ status: "stale" });
		expect(f.store.readV2()).toEqual(before);
		const result = await f.coordinator.updateBrowserPage(
			1,
			{ pane, resourceId: "browser", state },
			() => descriptor,
		);
		expect(result.status).toBe("saved");
		expect(
			f.store
				.readV2()
				.snapshot?.targets[0]?.workspaces[0]?.panes.find(
					(item) => item.kind === "browser",
				),
		).toMatchObject({ browser: state });
		expect(f.store.read().snapshot?.targets[0]?.workspaces[0]?.panes).toEqual(
			before.snapshot?.targets[0]?.workspaces[0]?.panes.filter(
				(item) => item.kind !== "browser",
			),
		);
		const revision = f.store.read().revision;
		expect(
			(
				await f.coordinator.updateBrowserPage(
					1,
					{ pane, resourceId: "browser", state },
					() => descriptor,
				)
			).status,
		).toBe("unchanged");
		expect(f.store.read().revision).toBe(revision);
		f.coordinator.activateOwner(2);
		const rejected = f.coordinator.updateBrowserPage(
			2,
			{ pane, resourceId: "browser", state: { ...state, pageTitle: "late" } },
			() => null,
		);
		expect(await rejected).toEqual({ status: "stale" });
		expect(f.store.read().revision).toBe(revision);
	} finally {
		f.close();
	}
});

test("a registered callback cannot update a replacement resource using the same pane id", async () => {
	const f = fixture();
	try {
		await seedTerminal(f);
		await saveBrowser(f);
		const descriptor = f.descriptor();
		const pane = {
			connectionId: f.id,
			generation: descriptor.generation,
			workspaceId: "workspace",
			paneId: "browser",
			registrationId: randomUUID(),
		};
		const input = {
			pane,
			resourceId: "browser",
			state: {
				url: "https://old.invalid/",
				pageTitle: "Old resource",
				faviconUrl: null,
			},
		};
		const replacement = browserInput(f);
		const browser = replacement.targets[0]?.workspaces[0]?.panes.find(
			(item) => item.kind === "browser",
		);
		if (!browser) throw Error("Missing fixture browser");
		browser.resourceId = "replacement";
		await saveBrowser(f, replacement);
		const before = f.store.readV2();
		expect(
			await f.coordinator.updateBrowserPage(1, input, () => descriptor),
		).toEqual({ status: "stale" });
		expect(f.store.readV2()).toEqual(before);
	} finally {
		f.close();
	}
});

test("an expired browser-open scope cannot advance navigation or write a view", async () => {
	const f = fixture();
	try {
		await seedTerminal(f);
		const before = f.store.readV2();
		expect(() =>
			f.coordinator.saveBrowserOpenV2(
				1,
				{
					expectedRevision: before.revision,
					navigationRevision: 9,
					view: browserInput(f),
					browserLeases: [
						{ connectionId: f.id, generation: f.descriptor().generation },
					],
				},
				() => false,
			),
		).toThrow("Browser open scope");
		expect(f.store.readV2()).toEqual(before);
		expect(f.coordinator.readV2().navigationRevision).toBe(0);
		expect(f.requests).toEqual([]);
	} finally {
		f.close();
	}
});

test("a scope lost during original workspace validation prevents the final browser write", async () => {
	const f = fixture(),
		started = Promise.withResolvers<void>(),
		checked = Promise.withResolvers<unknown>();
	let current = true;
	try {
		await seedTerminal(f);
		const before = f.store.readV2();
		f.setWorkspaceCheck(() => {
			started.resolve();
			return checked.promise;
		});
		const pending = f.coordinator
			.saveBrowserOpenV2(
				1,
				{
					expectedRevision: before.revision,
					navigationRevision: 0,
					view: browserInput(f),
					browserLeases: [
						{ connectionId: f.id, generation: f.descriptor().generation },
					],
				},
				() => current,
			)
			.catch((error) => error);
		await Promise.race([
			started.promise,
			pending.then(() => {
				throw Error("Save settled before its workspace check");
			}),
		]);
		current = false;
		checked.resolve({ id: "workspace" });
		expect((await pending).message).toContain("Browser open scope");
		expect(f.store.readV2()).toEqual(before);
	} finally {
		f.close();
	}
});

test("a current browser-open scope uses the original V2 workspace and terminal validation", async () => {
	const f = fixture();
	try {
		await seedTerminal(f);
		const saved = await f.coordinator.saveBrowserOpenV2(
			1,
			{
				expectedRevision: f.store.readV2().revision,
				navigationRevision: 0,
				view: browserInput(f),
				browserLeases: [
					{ connectionId: f.id, generation: f.descriptor().generation },
				],
			},
			() => true,
		);
		expect(saved.targets[0]?.workspaces[0]?.panes.map((p) => p.kind)).toEqual([
			"terminal",
			"browser",
		]);
		expect(f.requests.map((r) => r.path)).toEqual(["workspace.get"]);
	} finally {
		f.close();
	}
});

test("cancelling the actual renderer request during validation prevents its durable view commit", async () => {
	const f = fixture(),
		started = Promise.withResolvers<void>(),
		checked = Promise.withResolvers<unknown>();
	let delivered: WorkstationBrowserOpenEvent | undefined;
	const opens = new WorkstationBrowserOpenRequests({
		getOwner: () => ({ ownerId: 1, ownerEpoch: 1 }),
		changed: () => {},
		dispatch: (_owner, event) => {
			delivered = event;
		},
		schedule: () => () => {},
	});
	try {
		await seedTerminal(f);
		const before = f.store.readV2(),
			subscriptionId = randomUUID(),
			scope = opens.prepare(1, subscriptionId);
		expect(opens.confirmReady(1, { ...scope, subscriptionId })).toBe(true);
		const execute = opens.pin(
			{
				descriptor: f.descriptor(),
				workspaceId: "workspace",
				projectId: null,
				workspaceName: "Owned",
				url: "https://old.invalid/",
				target: "current-tab",
				show: false,
			},
			scope.scopeId,
			() => true,
		);
		const receipt = execute().catch((error) => error);
		const event = delivered;
		if (!event || event.type !== "open")
			throw Error("Missing renderer request");
		f.setWorkspaceCheck(() => {
			started.resolve();
			return checked.promise;
		});
		const save = f.coordinator
			.saveBrowserOpenV2(
				1,
				{
					expectedRevision: before.revision,
					navigationRevision: 0,
					view: browserInput(f),
					browserLeases: [
						{ connectionId: f.id, generation: f.descriptor().generation },
					],
				},
				() => opens.isCurrent(1, event),
			)
			.catch((error) => error);
		await Promise.race([
			started.promise,
			save.then(() => {
				throw Error("Save settled before validation");
			}),
		]);
		expect(
			opens.complete(1, {
				...event,
				ok: false,
				error: "Renderer layout changed",
			}),
		).toBe(true);
		checked.resolve({ id: "workspace" });
		expect((await save).message).toContain("Browser open scope");
		expect((await receipt).message).toBe("Renderer layout changed");
		expect(f.store.readV2()).toEqual(before);
	} finally {
		opens.dispose();
		f.close();
	}
});

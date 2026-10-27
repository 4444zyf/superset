import { afterEach, expect, test } from "bun:test";
import {
	createWorkspaceStore,
	transferPaneToSplit,
	transferTabToIndex,
} from "@superset/panes";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type {
	DirectDescriptor,
	DirectRpc,
	DirectWorkstationApi,
} from "shared/direct-workstation";
import type { WorkspaceViewV2Save } from "shared/workspace-view-v2";
import type {
	WorkspaceViewSnapshotV3,
	WorkspaceViewV3Save,
} from "shared/workspace-view-v3";
import { validateWorkspaceViewV3 } from "shared/workspace-view-v3";
import {
	fixture,
	required,
	workspace,
} from "../../../../../main/lib/ssh-direct/workspace-view-area-fixtures.test-data";
import { fromPaneLayout } from "../../utils/pane-adapter/pane-adapter";
import { buildPaneTree } from "../../utils/pane-layout/pane-layout";
import { projectBrowserOpenSnapshotV2 } from "../../utils/workspace-browser-open/workspace-browser-open-view-v3";
import { createWorkspacePaneAreaEdits } from "../../utils/workspace-pane-area-edits/workspace-pane-area-edits";
import {
	createWorkspacePaneAreas,
	readWorkspacePaneAreas,
	workspacePaneAreasStructureKey,
} from "../../utils/workspace-pane-areas/workspace-pane-areas";
import { registerWorkstationPaneRuntime } from "../../utils/workstation-pane-runtime/workstation-pane-runtime";
import { useWorkspaceViews } from "./useWorkspaceViews";

afterEach(cleanup);
function setup(
	enabled = true,
	complete = true,
	handler?: (request: DirectRpc) => Promise<unknown>,
) {
	let backing: WorkspaceViewSnapshotV3 = {
			...fixture(),
			restoreOnLaunch: false,
			schemaVersion: 3,
			revision: 1,
			updatedAt: 1,
		},
		navigation = 0,
		reads2 = 0,
		reads3 = 0;
	let nextGate: Promise<void> | undefined, release: (() => void) | undefined;
	const saves3: WorkspaceViewV3Save[] = [],
		saves2: WorkspaceViewV2Save[] = [],
		errors: string[] = [];
	const descriptor: DirectDescriptor = {
		connectionId: "local",
		generation: 1,
		backendId: "backend",
		namespaceId: "namespace",
		instanceId: "instance",
		capabilities: { workspaceViewRestoreV1: true },
	};
	const api = {
		async getWorkspaceView() {
			throw Error("Unexpected V1 read");
		},
		async saveWorkspaceView() {
			throw Error("Unexpected V1 save");
		},
		async getWorkspaceViewV2() {
			reads2++;
			return {
				snapshot: projectBrowserOpenSnapshotV2(backing),
				revision: backing.revision,
				invalid: false,
				navigationRevision: navigation,
			};
		},
		async saveWorkspaceViewV2(input: WorkspaceViewV2Save) {
			saves2.push(input);
			return {
				...input.view,
				schemaVersion: 2,
				revision: ++backing.revision,
				updatedAt: 2,
			};
		},
		async getWorkspaceViewV3() {
			reads3++;
			const gate = nextGate;
			nextGate = undefined;
			if (gate) await gate;
			return {
				snapshot: structuredClone(backing),
				revision: backing.revision,
				invalid: false,
				navigationRevision: navigation,
			};
		},
		async saveWorkspaceViewV3(input: WorkspaceViewV3Save) {
			saves3.push(input);
			expect(input.expectedRevision).toBe(backing.revision);
			navigation = input.navigationRevision;
			backing = {
				...validateWorkspaceViewV3(input.view),
				schemaVersion: 3,
				revision: backing.revision + 1,
				updatedAt: 2,
			};
			return structuredClone(backing);
		},
		async beginWorkspaceRestore() {
			throw Error("Must not connect");
		},
		async rpc(request: DirectRpc) {
			return handler ? handler(request) : [];
		},
		browser: {
			history: {},
			async navigate() {},
			async updatePage() {
				return {
					status: "saved",
					snapshot: projectBrowserOpenSnapshotV2(backing),
				};
			},
			openRequests: { saveViewV3: complete ? async () => backing : undefined },
		},
	} as unknown as DirectWorkstationApi;
	const hook = renderHook(() =>
		useWorkspaceViews(
			api,
			descriptor,
			{
				onSkeleton() {},
				onForget() {},
				async onDescriptor() {},
				onError: (message) => errors.push(message),
			},
			{ paneAreas: enabled },
		),
	);
	return {
		api,
		hook,
		descriptor,
		saves3,
		saves2,
		errors,
		backing: () => backing,
		reads2: () => reads2,
		reads3: () => reads3,
		gate() {
			nextGate = new Promise<void>((resolve) => {
				release = resolve;
			});
		},
		release() {
			required(release)();
		},
	};
}
test("the opt-in view hook reads full V3 while default and incomplete interfaces remain V2", async () => {
	for (const [enabled, complete] of [
		[true, true],
		[false, true],
		[true, false],
	] as const) {
		const f = setup(enabled, complete);
		await waitFor(() => expect(f.hook.result.current.view?.revision).toBe(1));
		expect(f.hook.result.current.paneAreasEnabled).toBe(enabled && complete);
		expect(f.hook.result.current.view?.schemaVersion).toBe(
			enabled && complete ? 3 : 2,
		);
		expect(enabled && complete ? f.reads2() : f.reads3()).toBe(0);
		f.hook.unmount();
	}
});
test("a V3 hook saves global changes without flattening right layout or fixed flags", async () => {
	const f = setup();
	await waitFor(() => expect(f.hook.result.current.view?.revision).toBe(1));
	await act(async () => {
		await f.hook.result.current.setRestoreOnLaunch(true);
	});
	expect(f.saves3).toHaveLength(1);
	expect(f.saves2).toHaveLength(0);
	expect(workspace(f.backing()).rightPaneLayout?.tabs).toHaveLength(1);
	expect(workspace(f.backing()).panes[0]?.pinned).toBe(true);
	expect(f.errors).toEqual([]);
});
test("accepting a legacy browser receipt waits for a full V3 refresh and preserves newer local tool intent", async () => {
	const f = setup();
	await waitFor(() => expect(f.hook.result.current.view?.revision).toBe(1));
	f.backing().revision = 2;
	const ack = projectBrowserOpenSnapshotV2(f.backing());
	f.gate();
	let pending: Promise<unknown> | undefined;
	act(() => {
		pending = Promise.resolve(
			f.hook.result.current.acceptBrowserOpen(ack, "local", "workspace", false),
		);
	});
	expect(f.hook.result.current.view?.revision).toBe(1);
	await act(async () => {
		await f.hook.result.current.setTool("workspace", "files");
	});
	await act(async () => {
		f.release();
		await pending;
	});
	expect(f.hook.result.current.view?.schemaVersion).toBe(3);
	expect(workspace(required(f.hook.result.current.view)).activeTool).toBe(
		"files",
	);
	expect(
		workspace(required(f.hook.result.current.view)).rightPaneLayout?.tabs,
	).toHaveLength(1);
	expect(f.errors).toEqual([]);
});
test("a legacy receipt cannot repopulate a scope after navigation changes during its refresh", async () => {
	const f = setup();
	await waitFor(() => expect(f.hook.result.current.view?.revision).toBe(1));
	f.backing().revision = 2;
	const ack = projectBrowserOpenSnapshotV2(f.backing());
	f.gate();
	let pending: Promise<unknown> | undefined;
	act(() => {
		pending = Promise.resolve(
			f.hook.result.current.acceptBrowserOpen(ack, "local", "workspace", false),
		).catch((error) => error);
	});
	act(() => f.hook.result.current.navigate());
	await act(async () => {
		f.release();
		const error = await pending;
		if (!(error instanceof Error)) throw Error("Missing cancelled receipt");
		expect(error.message).toContain("scope changed");
	});
	expect(f.hook.result.current.view?.revision).toBe(1);
	expect(f.errors).toEqual([]);
});

test("the real hook saves both original stores after an atomic cross-area transfer", async () => {
	const f = setup();
	await waitFor(() => expect(f.hook.result.current.view?.revision).toBe(1));
	const areas = createWorkspacePaneAreas(workspace(f.backing()), {
			scheduleMicrotask() {},
		}),
		before = areas.read();
	try {
		transferTabToIndex({
			source: areas.center,
			target: areas.right,
			tabId: "center-tab",
		});
		areas.activate("right");
		await act(async () => {
			await f.hook.result.current.savePaneAreas(
				"workspace",
				areas.read(),
				before,
			);
		});
		const w = workspace(f.backing());
		expect(w.panes).toHaveLength(2);
		expect(w.paneTabs).toEqual([]);
		expect(w.rightPaneLayout?.tabs).toHaveLength(2);
		expect(w.activePaneArea).toBe("right");
		expect(w.panes[0]?.pinned).toBe(true);
		expect(f.saves3).toHaveLength(1);
		expect(f.saves3[0]?.browserLeases).toEqual([
			{ connectionId: "local", generation: 1 },
		]);
		expect(f.errors).toEqual([]);
	} finally {
		areas.dispose();
	}
});
test("browser page updates refresh V3 instead of replacing the full view with their V2 projection", async () => {
	const f = setup();
	await waitFor(() => expect(f.hook.result.current.view?.revision).toBe(1));
	const reads = f.reads3();
	await act(async () => {
		f.hook.result.current.persistBrowserPage({
			pane: {
				connectionId: "local",
				generation: 1,
				workspaceId: "workspace",
				paneId: "browser",
				registrationId: "registration",
			},
			resourceId: "browser-resource",
			state: {
				url: "http://localhost:3001/",
				pageTitle: "Updated",
				faviconUrl: null,
			},
		});
		await f.hook.result.current.flush();
	});
	expect(f.reads3()).toBeGreaterThan(reads);
	expect(f.hook.result.current.view?.schemaVersion).toBe(3);
	expect(
		workspace(required(f.hook.result.current.view)).rightPaneLayout?.tabs,
	).toHaveLength(1);
	expect(f.errors).toEqual([]);
});

test("an unmounted hook rejects a late browser receipt without accepting its refreshed view", async () => {
	const f = setup();
	await waitFor(() => expect(f.hook.result.current.view?.revision).toBe(1));
	f.backing().revision = 2;
	f.gate();
	const pending = Promise.resolve(
		f.hook.result.current.acceptBrowserOpen(
			projectBrowserOpenSnapshotV2(f.backing()),
			"local",
			"workspace",
			false,
		),
	).catch((error) => error);
	f.hook.unmount();
	f.release();
	const error = await pending;
	if (!(error instanceof Error)) throw Error("Missing retired view error");
	expect(error.message).toContain("scope changed");
	expect(f.errors).toEqual([]);
});
test("V3 pane focus reaches a hidden right browser without moving center resources or Files", async () => {
	const f = setup();
	await waitFor(() => expect(f.hook.result.current.view?.revision).toBe(1));
	await act(async () => {
		await f.hook.result.current.setTool("workspace", "files");
		await f.hook.result.current.focusPane("workspace", "browser");
	});
	const w = workspace(f.backing());
	expect(w.activePaneArea).toBe("right");
	expect(w.rightPaneOpen).toBe(true);
	expect(w.activePaneId).toBe("browser");
	expect(w.activeTool).toBe("files");
	expect(w.panes).toHaveLength(2);
	expect(f.errors).toEqual([]);
});
test("closing a right browser through the real V3 hook retains the center terminal and pin", async () => {
	const f = setup();
	await waitFor(() => expect(f.hook.result.current.view?.revision).toBe(1));
	await act(async () => {
		await f.hook.result.current.closePane("workspace", "browser");
	});
	const w = workspace(f.backing());
	expect(w.panes.map((p) => p.paneId)).toEqual(["terminal"]);
	expect(w.panes[0]?.pinned).toBe(true);
	expect(w.rightPaneLayout?.tabs).toEqual([]);
	expect(f.errors).toEqual([]);
});
test("a new browser added by the V3 hook preserves the hidden right page and its explicit false pin", async () => {
	const f = setup();
	await waitFor(() => expect(f.hook.result.current.view?.revision).toBe(1));
	await act(async () => {
		await f.hook.result.current.newBrowser(
			"workspace",
			"http://localhost:3004/",
		);
	});
	const w = workspace(f.backing());
	expect(w.panes).toHaveLength(3);
	expect(w.rightPaneLayout?.tabs).toHaveLength(1);
	expect(w.panes.find((p) => p.paneId === "browser")?.pinned).toBe(false);
	expect(w.rightPaneOpen).toBe(false);
	expect(f.errors).toEqual([]);
});

test("a background browser close targets its owning connection rather than the selected connection", async () => {
	const f = setup();
	await waitFor(() => expect(f.hook.result.current.view?.revision).toBe(1));
	const other = structuredClone(required(f.backing().targets[0]));
	other.connectionId = "other";
	other.backendId = "other-backend";
	f.backing().targets.push(other);
	await act(async () => {
		await f.hook.result.current.read();
		await f.hook.result.current.closeBrowserPane(
			"other",
			"workspace",
			"browser",
			"browser-resource",
		);
	});
	expect(
		f.backing().targets.find((t) => t.connectionId === "local")?.workspaces[0]
			?.panes,
	).toHaveLength(2);
	expect(
		f
			.backing()
			.targets.find((t) => t.connectionId === "other")
			?.workspaces[0]?.panes.map((p) => p.paneId),
	).toEqual(["terminal"]);
	expect(f.errors).toEqual([]);
});

test("right-side legacy pane metadata saves preserve center resources and explicit pins", async () => {
	const f = setup();
	await waitFor(() => expect(f.hook.result.current.view?.revision).toBe(1));
	const before = readWorkspacePaneAreas(workspace(f.backing())).right,
		store = createWorkspaceStore({ initialState: before });
	store.getState().setPaneTitleOverride({
		tabId: "right-tab",
		paneId: "browser",
		titleOverride: "Right title",
	});
	await act(async () => {
		await f.hook.result.current.savePaneState(
			"workspace",
			store.getState(),
			before,
		);
	});
	expect(workspace(f.backing()).panes).toHaveLength(2);
	expect(
		workspace(f.backing()).panes.find((p) => p.paneId === "browser")?.label,
	).toBe("Right title");
	expect(workspace(f.backing()).panes[0]?.pinned).toBe(true);
	expect(workspace(f.backing()).panes[1]?.pinned).toBe(false);
	expect(f.errors).toEqual([]);
});
test("right-side splits and layout saves retain center Files, layout and execution", async () => {
	const f = setup();
	await waitFor(() => expect(f.hook.result.current.view?.revision).toBe(1));
	const center = structuredClone(workspace(f.backing()).paneTabs);
	await act(async () => {
		await f.hook.result.current.setTool("workspace", "files");
		await f.hook.result.current.focusPane("workspace", "browser");
		await f.hook.result.current.newBrowser(
			"workspace",
			"http://localhost:3005/",
			"split",
		);
	});
	const right = readWorkspacePaneAreas(workspace(f.backing())).right,
		tab = required(right.tabs[0]);
	if (tab.layout.type !== "split") throw Error("Missing right split");
	const layout = fromPaneLayout({ ...tab.layout, splitPercentage: 70 });
	expect(layout).toMatchObject({ ratio: 0.7 });
	await act(async () => {
		f.hook.result.current.saveLayout("workspace", layout, true, tab.id);
		await f.hook.result.current.flush();
	});
	const w = workspace(f.backing());
	expect(w.paneTabs).toEqual(center);
	expect(w.activeTool).toBe("files");
	expect(w.rightPaneLayout?.tabs[0]?.layout).toEqual(layout);
	expect(w.panes[0]?.executionId).toBe("execution");
	expect(f.errors).toEqual([]);
});

test("a split preset appends sessions to the selected right tab and retains the center execution", async () => {
	const calls: DirectRpc[] = [],
		f = setup(true, true, async (request) => {
			calls.push(request);
			if (request.path === "workspace.get")
				return { projectId: "project", worktreePath: "/remote/project" };
			return [];
		});
	await waitFor(() => expect(f.hook.result.current.view?.revision).toBe(1));
	f.descriptor.capabilities = {
		...f.descriptor.capabilities,
		terminals: true,
		durableOperations: true,
		workstationTerminalScriptExecutionV1: true,
	};
	const center = structuredClone(workspace(f.backing()).paneTabs);
	await act(async () => {
		await f.hook.result.current.focusPane("workspace", "browser");
		await f.hook.result.current.launchTerminalPreset(
			"workspace",
			{
				id: "preset",
				name: "Tools",
				commands: ["printf first", "printf second"],
				cwd: "scripts",
				projectIds: ["project"],
				executionMode: "split-pane",
				createdAt: new Date(0),
				tabOrder: 0,
			},
			[],
		);
	});
	const w = workspace(f.backing());
	expect(w.paneTabs).toEqual(center);
	expect(w.panes).toHaveLength(4);
	expect(w.rightPaneLayout?.tabs).toHaveLength(1);
	expect(
		readWorkspacePaneAreas(w).right.tabs[0]?.panes.browser?.data.resourceId,
	).toBe("browser-resource");
	expect(
		calls
			.filter((r) => r.path === "terminal.createSession")
			.map((r) => r.input),
	).toEqual([
		expect.objectContaining({
			initialCommand: "printf first",
			cwd: "/remote/project/scripts",
		}),
		expect.objectContaining({
			initialCommand: "printf second",
			cwd: "/remote/project/scripts",
		}),
	]);
	expect(w.panes[0]?.executionId).toBe("execution");
	expect(f.errors).toEqual([]);
});
test("closing an already removed right pane is harmless", async () => {
	const f = setup();
	await waitFor(() => expect(f.hook.result.current.view?.revision).toBe(1));
	await act(async () => {
		await f.hook.result.current.closePane("workspace", "browser");
		await f.hook.result.current.closePane("workspace", "browser");
		await f.hook.result.current.closeBrowserPane(
			"local",
			"workspace",
			"browser",
			"browser-resource",
		);
	});
	expect(workspace(f.backing()).panes.map((p) => p.paneId)).toEqual([
		"terminal",
	]);
	expect(f.errors).toEqual([]);
});

test("selecting an existing chat uses the chat owner area rather than the pane that initiated the action", async () => {
	const f = setup();
	await waitFor(() => expect(f.hook.result.current.view?.revision).toBe(1));
	const w = workspace(f.backing()),
		right = structuredClone(w.rightPaneLayout);
	w.panes.push({ paneId: "chat", kind: "chat", resourceId: "conversation" });
	w.layout = buildPaneTree(w.panes.map((p) => p.paneId));
	w.paneTabs?.push({
		tabId: "chat-tab",
		createdAt: 3,
		activePaneId: "chat",
		layout: { type: "pane", paneId: "chat" },
	});
	await act(async () => {
		await f.hook.result.current.read();
		await f.hook.result.current.selectChat(
			"workspace",
			"browser",
			"conversation",
		);
	});
	const saved = workspace(f.backing());
	expect(saved.activePaneArea).toBe("center");
	expect(saved.activePaneId).toBe("chat");
	expect(saved.rightPaneLayout).toEqual(right);
	expect(saved.panes).toHaveLength(3);
	expect(saved.panes.find((p) => p.paneId === "browser")?.resourceId).toBe(
		"browser-resource",
	);
	expect(f.errors).toEqual([]);
});
test("paired user selection becomes optimistic before its queued save so a browser refresh can preserve it", async () => {
	const f = setup();
	await waitFor(() => expect(f.hook.result.current.view?.revision).toBe(1));
	const areas = createWorkspacePaneAreas(workspace(f.backing()), {
			scheduleMicrotask() {},
		}),
		before = areas.read();
	try {
		areas.activate("right");
		f.gate();
		let pending: Promise<unknown> | undefined;
		act(() => {
			pending = f.hook.result.current.savePaneAreas(
				"workspace",
				areas.read(),
				before,
			);
		});
		expect(workspace(required(f.hook.result.current.view)).activePaneArea).toBe(
			"right",
		);
		expect(f.saves3).toHaveLength(0);
		await act(async () => {
			f.release();
			await pending;
		});
		expect(workspace(f.backing()).activePaneArea).toBe("right");
		expect(f.errors).toEqual([]);
	} finally {
		areas.dispose();
	}
});
test("an explicit pane edit scope saves a mounted background connection instead of the selected one", async () => {
	const f = setup();
	await waitFor(() => expect(f.hook.result.current.view?.revision).toBe(1));
	const other = structuredClone(required(f.backing().targets[0]));
	other.connectionId = "other";
	other.backendId = "other-backend";
	f.backing().targets.push(other);
	await act(async () => {
		await f.hook.result.current.read();
	});
	const areas = createWorkspacePaneAreas(required(other.workspaces[0]), {
			scheduleMicrotask() {},
		}),
		before = areas.read();
	try {
		areas.activate("right");
		const scope = {
			connectionId: other.connectionId,
			backendId: other.backendId,
			namespaceId: other.namespaceId,
			serviceUid: other.serviceUid,
			targetRevision: other.targetRevision,
			workspaceId: "workspace",
			tabId: "workspace-tab",
		};
		await act(async () => {
			await f.hook.result.current.savePaneAreas(
				"workspace",
				areas.read(),
				before,
				scope,
			);
		});
		expect(
			f.backing().targets.find((t) => t.connectionId === "local")?.workspaces[0]
				?.rightPaneOpen,
		).toBe(false);
		expect(
			f.backing().targets.find((t) => t.connectionId === "other")?.workspaces[0]
				?.activePaneArea,
		).toBe("right");
		expect(f.errors).toEqual([]);
	} finally {
		areas.dispose();
	}
});
test("a pane edit with an old explicit namespace scope cannot save or optimistically replace the current view", async () => {
	const f = setup();
	await waitFor(() => expect(f.hook.result.current.view?.revision).toBe(1));
	const areas = createWorkspacePaneAreas(workspace(f.backing()), {
			scheduleMicrotask() {},
		}),
		before = areas.read(),
		target = required(f.backing().targets[0]);
	try {
		areas.activate("right");
		await act(async () => {
			await f.hook.result.current.savePaneAreas(
				"workspace",
				areas.read(),
				before,
				{
					connectionId: target.connectionId,
					backendId: target.backendId,
					namespaceId: "old",
					serviceUid: target.serviceUid,
					targetRevision: target.targetRevision,
					workspaceId: "workspace",
					tabId: "workspace-tab",
				},
			);
		});
		expect(f.saves3).toHaveLength(0);
		expect(workspace(required(f.hook.result.current.view)).activePaneArea).toBe(
			"center",
		);
	} finally {
		areas.dispose();
	}
});

test("the existing hook flush drains a registered paired runtime and its pending original resize before acknowledging", async () => {
	const f = setup();
	await waitFor(() => expect(f.hook.result.current.view?.revision).toBe(1));
	const areas = createWorkspacePaneAreas(workspace(f.backing()), {
			scheduleMicrotask() {},
		}),
		timers = new Set<() => void>();
	const target = required(f.backing().targets[0]),
		scope = {
			connectionId: target.connectionId,
			backendId: target.backendId,
			namespaceId: target.namespaceId,
			serviceUid: target.serviceUid,
			targetRevision: target.targetRevision,
			workspaceId: "workspace",
			tabId: "workspace-tab",
		};
	const edits = createWorkspacePaneAreaEdits({
		save: (next, before) =>
			f.hook.result.current.savePaneAreas("workspace", next, before, scope),
		schedule(callback) {
			timers.add(callback);
			return () => {
				timers.delete(callback);
			};
		},
	});
	const offEdit = areas.subscribeEdits((next, before) =>
		edits.push(next, before),
	);
	const offRuntime = registerWorkstationPaneRuntime(
		f.api,
		f.descriptor,
		"workspace",
		"workspace-tab",
		{
			read: () => areas.center.getState(),
			readAreas: () => areas.read(),
			replace: (state) => {
				areas.replaceFromRuntime("center", state);
			},
			subscribe: (listener) => areas.subscribe(listener),
			fingerprint: () => workspacePaneAreasStructureKey(areas.read()),
			async flush() {
				areas.flush();
				await edits.flush();
			},
		},
	);
	try {
		await act(async () => {
			transferPaneToSplit({
				source: areas.right,
				target: areas.center,
				paneId: "browser",
				targetPaneId: "terminal",
				position: "right",
			});
			areas.flush();
			await edits.flush();
		});
		expect(f.saves3).toHaveLength(1);
		areas.center
			.getState()
			.resizeSplit({ tabId: "center-tab", path: [], splitPercentage: 71 });
		areas.flush();
		const staleTimers = [...timers];
		expect(f.saves3).toHaveLength(1);
		expect(timers.size).toBe(1);
		await act(async () => {
			await f.hook.result.current.flush();
		});
		expect(f.saves3).toHaveLength(2);
		expect(workspace(f.backing()).paneTabs?.[0]?.layout).toMatchObject({
			ratio: 0.71,
		});
		expect(timers.size).toBe(0);
		for (const callback of staleTimers) callback();
		await edits.flush();
		expect(f.saves3).toHaveLength(2);
		expect(f.errors).toEqual([]);
	} finally {
		offRuntime();
		offEdit();
		edits.dispose();
		areas.dispose();
	}
});

import { afterEach, expect, test } from "bun:test";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { DirectWorkstationApi } from "../../../../../shared/direct-workstation";
import type {
	WorkspaceRestoreSnapshot,
	WorkspaceViewSnapshot,
} from "../../../../../shared/workspace-view";
import { useWorkspaceViews } from "./useWorkspaceViews";

afterEach(cleanup);
test("successful manual restore reloads the main process auto-connect decision", async () => {
	const backing: WorkspaceViewSnapshot = {
		schemaVersion: 1,
		revision: 1,
		updatedAt: 1,
		restoreOnLaunch: true,
		activeConnectionId: "mac",
		window: { x: 0, y: 0, width: 1200, height: 900, maximized: false },
		targets: [
			{
				connectionId: "mac",
				targetRevision: 1,
				backendId: "backend",
				namespaceId: "namespace",
				serviceUid: 501,
				autoConnect: false,
				activeTabId: null,
				workspaces: [],
			},
		],
	};
	let receive!: (snapshot: WorkspaceRestoreSnapshot) => void;
	const api = {
		getWorkspaceView: async () => ({
			snapshot: structuredClone(backing),
			revision: backing.revision,
			invalid: false,
			navigationRevision: 0,
		}),
		saveWorkspaceView: async () => backing,
		onWorkspaceRestore: (listener: typeof receive) => {
			receive = listener;
			return () => {};
		},
		beginWorkspaceRestore: async () => ({
			jobId: "job",
			sequence: 1,
			viewRevision: 1,
			navigationRevision: 0,
			connectionId: "mac",
			status: "paused",
			reason: "disconnected",
			resources: [],
		}),
	} as unknown as DirectWorkstationApi;
	const hook = renderHook(() =>
		useWorkspaceViews(api, null, {
			onSkeleton: () => {},
			onForget: () => {},
			onDescriptor: async () => {},
			onError: () => {},
		}),
	);
	await waitFor(() =>
		expect(hook.result.current.view?.targets[0]?.autoConnect).toBe(false),
	);
	backing.targets[0]!.autoConnect = true;
	backing.revision++;
	act(() =>
		receive({
			jobId: "manual",
			sequence: 2,
			viewRevision: 2,
			navigationRevision: 0,
			connectionId: "mac",
			status: "ready",
			resources: [],
			descriptor: {
				connectionId: "mac",
				generation: 1,
				backendId: "backend",
				namespaceId: "namespace",
				instanceId: "new",
				capabilities: { workspaceViewRestoreV1: true },
			},
		}),
	);
	await waitFor(() =>
		expect(hook.result.current.view?.targets[0]?.autoConnect).toBe(true),
	);
});

test("upstream tab reorder and rename persist without changing execution ownership", async () => {
	let backing: WorkspaceViewSnapshot = {
		schemaVersion: 1,
		revision: 1,
		updatedAt: 1,
		restoreOnLaunch: false,
		activeConnectionId: "mac",
		window: { x: 0, y: 0, width: 1200, height: 900, maximized: false },
		targets: [
			{
				connectionId: "mac",
				targetRevision: 1,
				backendId: "backend",
				namespaceId: "namespace",
				serviceUid: 501,
				autoConnect: false,
				activeTabId: "a",
				workspaces: ["a", "b"].map((id) => ({
					tabId: id,
					workspaceId: `workspace-${id}`,
					label: id,
					activeTool: "terminal" as const,
					activePaneId: `pane-${id}`,
					panes: [
						{
							paneId: `pane-${id}`,
							kind: "terminal" as const,
							resourceId: `session-${id}`,
							executionId: `exec-${id}`,
						},
					],
					layout: { type: "pane" as const, paneId: `pane-${id}` },
				})),
			},
		],
	};
	const original = structuredClone(backing.targets[0]!.workspaces);
	const api = {
		getWorkspaceView: async () => ({
			snapshot: structuredClone(backing),
			revision: backing.revision,
			invalid: false,
			navigationRevision: 0,
		}),
		saveWorkspaceView: async ({
			view,
			expectedRevision,
		}: Parameters<
			NonNullable<DirectWorkstationApi["saveWorkspaceView"]>
		>[0]) => {
			expect(expectedRevision).toBe(backing.revision);
			backing = {
				...view,
				schemaVersion: 1,
				revision: backing.revision + 1,
				updatedAt: 1,
			};
			return structuredClone(backing);
		},
		beginWorkspaceRestore: async () => {
			throw new Error("Disabled restore must not connect");
		},
	} as unknown as DirectWorkstationApi;
	const hook = renderHook(() =>
		useWorkspaceViews(api, null, {
			onSkeleton: () => {},
			onDescriptor: async () => {},
			onForget: () => {},
			onError: (message) => {
				throw new Error(message);
			},
		}),
	);
	await waitFor(() => expect(hook.result.current.view?.revision).toBe(1));
	await act(async () => {
		await hook.result.current.reorderTab("b", 0);
		await hook.result.current.renameTab("a", "Claude");
	});
	expect(backing.targets[0]!.workspaces.map((w) => w.tabId)).toEqual([
		"b",
		"a",
	]);
	expect(backing.targets[0]!.activeTabId).toBe("a");
	expect(backing.targets[0]!.workspaces[1]!.label).toBe("Claude");
	for (const w of backing.targets[0]!.workspaces) {
		expect(w.workspaceId).toBe(`workspace-${w.tabId}`);
		expect(w.panes).toEqual(original.find((o) => o.tabId === w.tabId)!.panes);
	}
});

test("rerunning a command reuses its pane and preserves its saved layout and title", async () => {
	const connection = {
		connectionId: "remote",
		backendId: "backend",
		namespaceId: "namespace",
		instanceId: "instance",
		generation: 1,
	};
	const layout = {
		type: "split" as const,
		axis: "vertical" as const,
		ratio: 0.65,
		first: { type: "pane" as const, paneId: "editor" },
		second: { type: "pane" as const, paneId: "console" },
	};
	let backing: WorkspaceViewSnapshot = {
		schemaVersion: 1,
		revision: 1,
		updatedAt: 1,
		restoreOnLaunch: false,
		activeConnectionId: "remote",
		window: { x: 0, y: 0, width: 1200, height: 900, maximized: false },
		targets: [
			{
				connectionId: "remote",
				backendId: "backend",
				namespaceId: "namespace",
				targetRevision: 1,
				serviceUid: 1000,
				autoConnect: true,
				activeTabId: "tab",
				workspaces: [
					{
						tabId: "tab",
						workspaceId: "workspace",
						activeTool: "files",
						activePaneId: "editor",
						panes: [
							{
								paneId: "editor",
								kind: "terminal",
								resourceId: "editor-terminal",
							},
							{
								paneId: "console",
								kind: "terminal",
								resourceId: "old-run",
								executionId: "old-execution",
								label: "My server",
							},
						],
						layout,
					},
				],
			},
		],
	};
	const api = {
		getWorkspaceView: async () => ({
			snapshot: structuredClone(backing),
			revision: backing.revision,
			invalid: false,
			navigationRevision: 0,
		}),
		saveWorkspaceView: async (input: { view: WorkspaceViewSnapshot }) => {
			backing = {
				...input.view,
				schemaVersion: 1,
				revision: backing.revision + 1,
				updatedAt: 2,
			};
			return structuredClone(backing);
		},
		beginWorkspaceRestore: async () => {
			throw new Error("must not restore automatically");
		},
	} as unknown as DirectWorkstationApi;
	const hook = renderHook(() =>
		useWorkspaceViews(api, connection, {
			onSkeleton: () => {},
			onForget: () => {},
			onDescriptor: async () => {},
			onError: () => {},
		}),
	);
	await waitFor(() => expect(hook.result.current.view?.revision).toBe(1));
	await act(async () => {
		await hook.result.current.addPane(
			"workspace",
			{
				paneId: "new-pane",
				kind: "terminal",
				resourceId: "new-run",
				executionId: "new-execution",
				label: "Run",
			},
			"vertical",
			{ connection, placement: "root", replaceResourceId: "old-run" },
		);
	});
	const workspace = backing.targets[0]!.workspaces[0]!;
	expect(workspace.panes).toHaveLength(2);
	expect(workspace.panes[1]).toMatchObject({
		paneId: "console",
		resourceId: "new-run",
		executionId: "new-execution",
		label: "My server",
	});
	expect(workspace.layout).toEqual(layout);
	expect(workspace.activeTool).toBe("terminal");
	expect(workspace.activePaneId).toBe("console");
});

test("creation titles label existing setup resources without reopening or creating terminals", async () => {
	const connection = {
		connectionId: "remote",
		generation: 1,
		backendId: "backend",
		namespaceId: "namespace",
		instanceId: "instance",
		capabilities: { workspaceViewRestoreV1: true },
	};
	let backing: WorkspaceViewSnapshot = {
		schemaVersion: 1,
		revision: 1,
		updatedAt: 1,
		restoreOnLaunch: false,
		activeConnectionId: "remote",
		window: { x: 0, y: 0, width: 1200, height: 900, maximized: false },
		targets: [
			{
				connectionId: "remote",
				targetRevision: 1,
				backendId: "backend",
				namespaceId: "namespace",
				serviceUid: 1000,
				autoConnect: true,
				activeTabId: null,
				workspaces: [],
			},
		],
	};
	const calls: string[] = [];
	const api = {
		getWorkspaceView: async () => ({
			snapshot: structuredClone(backing),
			revision: backing.revision,
			invalid: false,
			navigationRevision: 0,
		}),
		saveWorkspaceView: async ({ view }: { view: WorkspaceViewSnapshot }) => {
			backing = {
				...view,
				schemaVersion: 1,
				revision: backing.revision + 1,
				updatedAt: 2,
			};
			return structuredClone(backing);
		},
		beginWorkspaceRestore: async () => {
			throw new Error("must not restore");
		},
		rpc: async (r: { path: string; type: string }) => {
			calls.push(r.path);
			expect(r.type).toBe("query");
			if (r.path === "workspace.restoreResources") return [];
			return {
				sessions: [
					{ terminalId: "setup", title: "shell" },
					{ terminalId: "other", title: "My terminal" },
				],
			};
		},
	} as unknown as DirectWorkstationApi;
	const hook = renderHook(() =>
		useWorkspaceViews(api, connection, {
			onSkeleton() {},
			onForget() {},
			onDescriptor: async () => {},
			onError(e) {
				throw new Error(e);
			},
		}),
	);
	await waitFor(() => expect(hook.result.current.view?.revision).toBe(1));
	await act(async () => {
		await hook.result.current.openWorkspace(
			{ id: "workspace", name: "Example", worktreePath: "/remote/project" },
			[
				{ terminalId: "setup", label: "Setup" },
				{ terminalId: "not-listed", label: "Stale" },
			],
		);
	});
	expect(backing.targets[0]!.workspaces[0]!.panes.map((p) => p.label)).toEqual([
		"Setup",
		"My terminal",
	]);
	await act(async () => {
		await hook.result.current.openWorkspace(
			{ id: "workspace", name: "Example", worktreePath: "/remote/project" },
			[{ terminalId: "setup", label: "Do not replace" }],
		);
	});
	expect(backing.targets[0]!.workspaces[0]!.panes[0]!.label).toBe("Setup");
	expect(calls.filter((path) => path === "terminal.list")).toEqual([
		"terminal.list",
	]);
	expect(
		calls.every((path) =>
			["terminal.list", "workspace.restoreResources"].includes(path),
		),
	).toBe(true);
});

test("deleting a workspace removes all its saved tabs only from its owning backend", async () => {
	const connection = {
		connectionId: "remote",
		backendId: "backend",
		namespaceId: "namespace",
		instanceId: "instance",
		generation: 1,
	};
	const tab = (tabId: string, workspaceId: string) => ({
		tabId,
		workspaceId,
		activeTool: "terminal" as const,
		activePaneId: null,
		panes: [],
		layout: null,
	});
	let backing: WorkspaceViewSnapshot = {
		schemaVersion: 1,
		revision: 1,
		updatedAt: 1,
		restoreOnLaunch: false,
		activeConnectionId: "remote",
		window: { x: 0, y: 0, width: 1200, height: 900, maximized: false },
		targets: [
			{
				...connection,
				targetRevision: 1,
				serviceUid: 1000,
				autoConnect: true,
				activeTabId: "one",
				workspaces: [
					tab("one", "deleted"),
					tab("two", "deleted"),
					tab("keep", "kept"),
				],
			},
			{
				...connection,
				connectionId: "other",
				targetRevision: 1,
				serviceUid: 1000,
				autoConnect: true,
				activeTabId: "other",
				workspaces: [tab("other", "deleted")],
			},
		],
	};
	const api = {
		getWorkspaceView: async () => ({
			snapshot: structuredClone(backing),
			revision: backing.revision,
			invalid: false,
			navigationRevision: 0,
		}),
		saveWorkspaceView: async ({ view }: { view: WorkspaceViewSnapshot }) => {
			backing = {
				...view,
				schemaVersion: 1,
				revision: backing.revision + 1,
				updatedAt: 2,
			};
			return backing;
		},
		beginWorkspaceRestore: async () => {
			throw new Error("must not restore");
		},
	} as unknown as DirectWorkstationApi;
	const hook = renderHook(() =>
		useWorkspaceViews(api, connection, {
			onSkeleton() {},
			onForget() {},
			async onDescriptor() {},
			onError() {},
		}),
	);
	await waitFor(() => expect(hook.result.current.view?.revision).toBe(1));
	await act(async () => {
		await hook.result.current.removeWorkspace(
			{ ...connection, namespaceId: "wrong" },
			"deleted",
		);
	});
	expect(backing.targets[0]?.workspaces).toHaveLength(3);
	await act(async () => {
		await hook.result.current.removeWorkspace(connection, "deleted");
	});
	expect(backing.targets[0]?.workspaces.map((w) => w.tabId)).toEqual(["keep"]);
	expect(backing.targets[0]?.activeTabId).toBe("keep");
	expect(backing.targets[1]?.workspaces.map((w) => w.tabId)).toEqual(["other"]);
});

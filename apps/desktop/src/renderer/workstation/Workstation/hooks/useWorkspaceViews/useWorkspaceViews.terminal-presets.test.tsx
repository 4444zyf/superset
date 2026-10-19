import { afterEach, expect, test } from "bun:test";
import type {
	HostAgentConfig,
	HostTerminalPreset,
} from "@superset/host-service/settings";
import { createWorkspaceStore } from "@superset/panes";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type {
	DirectDescriptor,
	DirectRpc,
	DirectWorkstationApi,
} from "../../../../../shared/direct-workstation";
import type { WorkspaceViewSnapshot } from "../../../../../shared/workspace-view";
import { toPaneState } from "../../utils/pane-adapter/pane-adapter";
import { useWorkspaceViews } from "./useWorkspaceViews";

afterEach(cleanup);
function fixture(
	advertised: boolean,
	captureError?: (message: string) => void,
	triggerPresets?: HostTerminalPreset[],
	triggerAgents?: HostAgentConfig[],
) {
	let connection: DirectDescriptor = {
		connectionId: "ssh",
		backendId: "backend",
		namespaceId: "namespace",
		instanceId: "instance",
		generation: 2,
		capabilities: {
			durableOperations: true,
			terminals: true,
			workstationTerminalPresetsV1: advertised,
			workstationTerminalScriptExecutionV1: advertised,
			workstationTerminalScriptsV1: triggerPresets !== undefined,
			workstationAgentCatalogV2: triggerAgents !== undefined,
		},
	};
	let backing: WorkspaceViewSnapshot = {
		schemaVersion: 1,
		revision: 1,
		updatedAt: 1,
		restoreOnLaunch: false,
		activeConnectionId: "ssh",
		window: { x: 0, y: 0, width: 1200, height: 900, maximized: false },
		targets: [
			{
				connectionId: "ssh",
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
						activeTool: "terminal",
						activePaneId: "original",
						layout: { type: "pane", paneId: "original" },
						panes: [
							{
								paneId: "original",
								kind: "terminal",
								resourceId: "retained",
								executionId: "retained-execution",
								label: "My terminal",
							},
						],
					},
				],
			},
		],
	};
	const calls: DirectRpc[] = [];
	let catalogGate: Promise<void> | null = null;
	let catalogFailure = false;
	let nextSave: Promise<void> | null = null;
	let failLayoutSave = false;
	let flushHandler: () => Promise<void> = async () => {};
	let nextCreate: Promise<void> | null = null,
		createCalls = 0,
		failCreateAt: number | null = null;
	const api = {
		onWorkspaceViewFlush: (listener: () => Promise<void>) => {
			flushHandler = listener;
			return () => {};
		},
		getWorkspaceView: async () => ({
			snapshot: structuredClone(backing),
			revision: backing.revision,
			invalid: false,
			navigationRevision: 0,
		}),
		saveWorkspaceView: async ({ view }: { view: WorkspaceViewSnapshot }) => {
			if (failLayoutSave) throw new Error("Layout save failed");
			const gate = nextSave;
			nextSave = null;
			if (gate) await gate;
			backing = {
				...view,
				schemaVersion: 1,
				revision: backing.revision + 1,
				updatedAt: 2,
			};
			return structuredClone(backing);
		},
		beginWorkspaceRestore: async () => {
			throw new Error("must not reconnect");
		},
		rpc: async (r: DirectRpc) => {
			calls.push(r);
			if (r.path === "settings.agentConfigs.catalogWithRevisionV2")
				return {
					configs: structuredClone(triggerAgents ?? []),
					revision: "b".repeat(64),
				};
			if (r.path === "settings.terminalPresets.catalogWithRevisionV1") {
				await catalogGate;
				if (catalogFailure) throw new Error("Catalog unavailable");
				return {
					initialized: true,
					presets: structuredClone(triggerPresets ?? []),
					revision: "a".repeat(64),
				};
			}
			if (r.path === "terminal.createSession") {
				createCalls++;
				const gate = nextCreate;
				nextCreate = null;
				if (gate) await gate;
				if (createCalls === failCreateAt) throw new Error("Response lost");
			}
			if (r.path === "workspace.get")
				return {
					id: "workspace",
					projectId: "project",
					worktreePath: "/remote/project",
				};
			if (r.path === "workspace.restoreResources")
				return [
					{
						workspaceId: "workspace",
						resourceId: "retained",
						executionId: "retained-execution",
						kind: "terminal",
						state: "live",
					},
				];
			return {
				terminalId: (r.input as { terminalId: string }).terminalId,
				status: "active",
			};
		},
	} as unknown as DirectWorkstationApi;
	const hook = renderHook(() =>
		useWorkspaceViews(api, connection, {
			onSkeleton: () => {},
			onDescriptor: async () => {},
			onForget: () => {},
			onError: (message) => {
				if (captureError) {
					captureError(message);
					return;
				}
				throw new Error(message);
			},
		}),
	);
	return {
		hook,
		calls,
		saved: () => backing,
		flush: () => flushHandler(),
		failLayoutSave: () => {
			failLayoutSave = true;
		},
		failCatalog: () => {
			catalogFailure = true;
		},
		pauseCatalog: () => {
			let release = () => {};
			catalogGate = new Promise<void>((resolve) => {
				release = resolve;
			});
			return release;
		},
		pauseNextCreate: () => {
			let release = () => {};
			nextCreate = new Promise<void>((resolve) => {
				release = resolve;
			});
			return release;
		},
		failCreate: (index: number) => {
			failCreateAt = index;
		},
		switchTarget: () => {
			connection = { ...connection, connectionId: "other", generation: 9 };
			hook.rerender();
		},
		pauseNextSave: () => {
			let release = () => {};
			nextSave = new Promise<void>((resolve) => {
				release = resolve;
			});
			return release;
		},
	};
}
test("a terminal preset sends its original command once to the selected SSH backend and keeps original terminals", async () => {
	const f = fixture(true);
	await waitFor(() => expect(f.hook.result.current.view?.revision).toBe(1));
	const initialCommand = "REMIX_CHECK='中文 value' printf '%s' 'hello world'";
	await act(async () =>
		f.hook.result.current.newTerminal("workspace", "horizontal", {
			initialCommand,
			label: "My agent",
		}),
	);
	expect(f.calls).toHaveLength(1);
	expect(f.calls[0]).toMatchObject({
		connectionId: "ssh",
		generation: 2,
		path: "terminal.createSession",
		type: "mutation",
		input: { workspaceId: "workspace", initialCommand },
	});
	expect((f.calls[0]?.input as { operationId: string }).operationId).toMatch(
		/^[0-9a-f-]{36}$/,
	);
	const panes = f.saved().targets[0]?.workspaces[0]?.panes;
	expect(panes?.[0]).toMatchObject({
		resourceId: "retained",
		executionId: "retained-execution",
		label: "My terminal",
	});
	expect(panes?.[1]?.label).toBe("My agent");
	f.hook.rerender();
	expect(f.calls).toHaveLength(1);
});
test("an older backend does not receive a preset command but can still create an ordinary shell", async () => {
	const f = fixture(false);
	await waitFor(() => expect(f.hook.result.current.view?.revision).toBe(1));
	await act(async () =>
		f.hook.result.current.newTerminal("workspace", "horizontal", {
			initialCommand: "printf keep",
			label: "Preset",
		}),
	);
	expect(f.calls).toEqual([]);
	await act(async () =>
		f.hook.result.current.newTerminal("workspace", "horizontal"),
	);
	expect(f.calls).toHaveLength(1);
	expect(f.calls[0]?.input).not.toHaveProperty("initialCommand");
});

test("New terminal opens an original tab and subsequent splits stay inside that active tab", async () => {
	const f = fixture(true);
	await waitFor(() => expect(f.hook.result.current.view?.revision).toBe(1));
	const original = f.saved().targets[0]!.workspaces[0]!;
	await act(async () =>
		f.hook.result.current.newTerminal("workspace", "horizontal", undefined, {
			placement: "new-tab",
		}),
	);
	const first = f.saved().targets[0]!.workspaces[0]!;
	expect(first.paneTabs).toHaveLength(2);
	expect(first.paneTabs?.[0]?.layout).toEqual(original.layout!);
	expect(first.paneTabs?.[0]?.activePaneId).toBe("original");
	expect(first.activePaneTabId).toBe(first.paneTabs?.[1]?.tabId);
	await act(async () =>
		f.hook.result.current.newTerminal("workspace", "vertical"),
	);
	const split = f.saved().targets[0]!.workspaces[0]!;
	expect(split.paneTabs).toHaveLength(2);
	expect(split.paneTabs?.[0]?.layout).toEqual(original.layout!);
	expect(split.paneTabs?.[1]?.layout).toMatchObject({
		type: "split",
		axis: "vertical",
	});
	expect(split.panes[0]).toEqual(original.panes[0]);
	expect(f.calls).toHaveLength(2);
	f.hook.rerender();
	expect(f.calls).toHaveLength(2);
});

test("existing focus and close actions select the owning terminal tab and remove empty groups", async () => {
	const f = fixture(true);
	await waitFor(() => expect(f.hook.result.current.view?.revision).toBe(1));
	await act(async () =>
		f.hook.result.current.newTerminal("workspace", "horizontal", undefined, {
			placement: "new-tab",
		}),
	);
	const added = f.saved().targets[0]!.workspaces[0]!.panes[1]!.paneId;
	await act(async () =>
		f.hook.result.current.focusPane("workspace", "original"),
	);
	let workspace = f.saved().targets[0]!.workspaces[0]!;
	expect(workspace.activePaneTabId).toBe(workspace.paneTabs?.[0]?.tabId);
	await act(async () => f.hook.result.current.closePane("workspace", added));
	workspace = f.saved().targets[0]!.workspaces[0]!;
	expect(workspace.paneTabs).toHaveLength(1);
	expect(workspace.panes).toHaveLength(1);
	expect(workspace.panes[0]?.executionId).toBe("retained-execution");
	expect(f.calls).toHaveLength(1);
});

test("original pane store tab rename and close persist with no extra terminal RPC or replay", async () => {
	const f = fixture(true);
	await waitFor(() => expect(f.hook.result.current.view?.revision).toBe(1));
	await act(async () =>
		f.hook.result.current.newTerminal("workspace", "horizontal", undefined, {
			placement: "new-tab",
		}),
	);
	let before = toPaneState(f.saved().targets[0]!.workspaces[0]!);
	const store = createWorkspaceStore({ initialState: before });
	const id = store.getState().activeTabId!;
	store
		.getState()
		.setTabTitleOverride({ tabId: id, titleOverride: "Retained group" });
	await act(async () =>
		f.hook.result.current.savePaneState("workspace", store.getState(), before),
	);
	expect(f.saved().targets[0]!.workspaces[0]!.paneTabs?.[1]?.label).toBe(
		"Retained group",
	);
	before = toPaneState(f.saved().targets[0]!.workspaces[0]!);
	store.getState().replaceState(before);
	store.getState().removeTab(id);
	await act(async () =>
		f.hook.result.current.savePaneState("workspace", store.getState(), before),
	);
	expect(f.saved().targets[0]!.workspaces[0]!.paneTabs).toHaveLength(1);
	expect(f.saved().targets[0]!.workspaces[0]!.panes[0]?.resourceId).toBe(
		"retained",
	);
	expect(f.calls).toHaveLength(1);
});

test("a delayed split resize updates its captured terminal tab after the user selects another tab", async () => {
	const f = fixture(true);
	await waitFor(() => expect(f.hook.result.current.view?.revision).toBe(1));
	await act(async () =>
		f.hook.result.current.newTerminal("workspace", "horizontal", undefined, {
			placement: "new-tab",
		}),
	);
	await act(async () =>
		f.hook.result.current.newTerminal("workspace", "vertical"),
	);
	const group = f.saved().targets[0]!.workspaces[0]!.paneTabs![1]!;
	if (group.layout.type !== "split") throw new Error("expected grouped split");
	const resized = { ...group.layout, ratio: 0.61 };
	await act(async () =>
		f.hook.result.current.focusPane("workspace", "original"),
	);
	await act(async () => {
		f.hook.result.current.saveLayout("workspace", resized, true, group.tabId);
	});
	await waitFor(() =>
		expect(
			f.saved().targets[0]!.workspaces[0]!.paneTabs?.[1]?.layout,
		).toMatchObject({ ratio: 0.61 }),
	);
	const workspace = f.saved().targets[0]!.workspaces[0]!;
	expect(workspace.activePaneTabId).toBe(workspace.paneTabs?.[0]?.tabId);
	expect(workspace.paneTabs?.[0]?.layout).toEqual({
		type: "pane",
		paneId: "original",
	});
	expect(f.calls).toHaveLength(2);
});

test("pending metadata saves keep typed titles visible while a terminal focus update is queued", async () => {
	const f = fixture(true);
	await waitFor(() => expect(f.hook.result.current.view?.revision).toBe(1));
	await act(async () =>
		f.hook.result.current.newTerminal("workspace", "horizontal", undefined, {
			placement: "new-tab",
		}),
	);
	const w = f.saved().targets[0]!.workspaces[0]!,
		before = toPaneState(w),
		store = createWorkspaceStore({ initialState: before });
	store.getState().setPaneTitleOverride({
		tabId: store.getState().getPane("original")!.tabId,
		paneId: "original",
		titleOverride: "Typing is retained",
	});
	const release = f.pauseNextSave();
	let saving: Promise<unknown>;
	act(() => {
		saving = f.hook.result.current.savePaneState(
			"workspace",
			store.getState(),
			before,
		);
	});
	expect(
		f.hook.result.current.view?.targets[0]?.workspaces[0]?.panes[0]?.label,
	).toBe("Typing is retained");
	let focus: Promise<unknown>;
	act(() => {
		focus = f.hook.result.current.focusPane("workspace", "original");
	});
	expect(
		f.hook.result.current.view?.targets[0]?.workspaces[0]?.panes[0]?.label,
	).toBe("Typing is retained");
	await act(async () => {
		release();
		await saving;
		await focus;
	});
	expect(f.saved().targets[0]?.workspaces[0]?.panes[0]?.label).toBe(
		"Typing is retained",
	);
});

function scriptPreset(
	mode: HostTerminalPreset["executionMode"],
): HostTerminalPreset {
	return {
		id: "11111111-1111-4111-8111-111111111111",
		name: "Project tools",
		commands: ["printf first", "printf second"],
		cwd: "scripts",
		projectIds: ["project"],
		executionMode: mode,
		createdAt: new Date(0),
		tabOrder: 0,
	};
}
test.each([
	"split-pane",
	"new-tab",
	"new-tab-split-pane",
] as const)("script mode %s keeps the original terminal layout and one command per new session", async (mode) => {
	const f = fixture(true);
	await waitFor(() => expect(f.hook.result.current.view?.revision).toBe(1));
	await act(async () =>
		f.hook.result.current.launchTerminalPreset(
			"workspace",
			scriptPreset(mode),
			[],
		),
	);
	const creates = f.calls.filter((r) => r.path === "terminal.createSession");
	expect(creates).toHaveLength(2);
	expect(
		creates.map((r) => (r.input as { initialCommand: string }).initialCommand),
	).toEqual(["printf first", "printf second"]);
	expect(
		creates.every(
			(r) => (r.input as { cwd: string }).cwd === "/remote/project/scripts",
		),
	).toBe(true);
	const w = f.saved().targets[0]!.workspaces[0]!;
	expect(w.panes).toHaveLength(3);
	expect(w.panes[0]?.resourceId).toBe("retained");
	expect(w.paneTabs).toHaveLength(
		mode === "new-tab" ? 3 : mode === "split-pane" ? 1 : 2,
	);
	if (mode !== "split-pane")
		expect(w.paneTabs?.[0]?.layout).toEqual({
			type: "pane",
			paneId: "original",
		});
	f.hook.rerender();
	expect(
		f.calls.filter((r) => r.path === "terminal.createSession"),
	).toHaveLength(2);
});
test("sequential scripts use the captured terminal execution once and preserve its custom title", async () => {
	const f = fixture(true);
	await waitFor(() => expect(f.hook.result.current.view?.revision).toBe(1));
	await act(async () =>
		f.hook.result.current.launchTerminalPreset(
			"workspace",
			scriptPreset("sequential"),
			[],
		),
	);
	const sends = f.calls.filter((r) => r.path === "terminal.runScriptV1");
	expect(sends).toHaveLength(1);
	expect(sends[0]).toMatchObject({
		connectionId: "ssh",
		generation: 2,
		input: {
			workspaceId: "workspace",
			terminalId: "retained",
			executionId: "retained-execution",
			text: "cd /remote/project/scripts && printf first && printf second",
		},
	});
	expect(
		f.calls.filter((r) => r.path === "terminal.createSession"),
	).toHaveLength(0);
	expect(f.saved().targets[0]?.workspaces[0]?.panes[0]?.label).toBe(
		"My terminal",
	);
	f.hook.rerender();
	expect(f.calls.filter((r) => r.path === "terminal.runScriptV1")).toHaveLength(
		1,
	);
});

test("a target switch during creation never launches the remaining script commands or appends foreign panes", async () => {
	const f = fixture(true);
	await waitFor(() => expect(f.hook.result.current.view?.revision).toBe(1));
	const release = f.pauseNextCreate();
	let running: Promise<unknown>;
	act(() => {
		running = f.hook.result.current.launchTerminalPreset(
			"workspace",
			scriptPreset("new-tab"),
			[],
		);
	});
	await waitFor(() =>
		expect(
			f.calls.filter((r) => r.path === "terminal.createSession"),
		).toHaveLength(1),
	);
	act(() => f.switchTarget());
	await act(async () => {
		release();
		await running;
	});
	expect(
		f.calls.filter((r) => r.path === "terminal.createSession"),
	).toHaveLength(1);
	expect(f.saved().targets[0]?.workspaces[0]?.panes).toHaveLength(1);
});
test("a partial script launch retains confirmed terminals and never replays a lost creation reply", async () => {
	const errors: string[] = [],
		f = fixture(true, (message) => errors.push(message));
	await waitFor(() => expect(f.hook.result.current.view?.revision).toBe(1));
	f.failCreate(2);
	await act(async () =>
		f.hook.result.current.launchTerminalPreset(
			"workspace",
			scriptPreset("new-tab-split-pane"),
			[],
		),
	);
	expect(errors.some((message) => message.includes("Response lost"))).toBe(
		true,
	);
	expect(f.saved().targets[0]?.workspaces[0]?.panes).toHaveLength(2);
	const creates = f.calls.filter((r) => r.path === "terminal.createSession");
	expect(creates).toHaveLength(2);
	expect(f.saved().targets[0]?.workspaces[0]?.panes[1]?.resourceId).toBe(
		(creates[0]?.input as { terminalId: string }).terminalId,
	);
	f.hook.rerender();
	expect(
		f.calls.filter((r) => r.path === "terminal.createSession"),
	).toHaveLength(2);
});

test("normal window flush waits for the requested script batch and its saved pane layout", async () => {
	const f = fixture(true);
	await waitFor(() => expect(f.hook.result.current.view?.revision).toBe(1));
	const release = f.pauseNextCreate();
	let running: Promise<unknown>;
	act(() => {
		running = f.hook.result.current.launchTerminalPreset(
			"workspace",
			scriptPreset("new-tab"),
			[],
		);
	});
	await waitFor(() =>
		expect(
			f.calls.filter((r) => r.path === "terminal.createSession"),
		).toHaveLength(1),
	);
	let flushed = false;
	const flushing = f.flush().then(() => {
		flushed = true;
	});
	try {
		await act(async () => {
			await Promise.resolve();
			await Promise.resolve();
		});
		expect(flushed).toBe(false);
	} finally {
		await act(async () => {
			release();
			await running;
			await flushing;
		});
	}
	expect(flushed).toBe(true);
	expect(
		f.calls.filter((r) => r.path === "terminal.createSession"),
	).toHaveLength(2);
	expect(f.saved().targets[0]?.workspaces[0]?.panes).toHaveLength(3);
});

test("normal window flush also waits for an ordinary terminal launch and its view reference", async () => {
	const f = fixture(true);
	await waitFor(() => expect(f.hook.result.current.view?.revision).toBe(1));
	const release = f.pauseNextCreate();
	let running: Promise<unknown>;
	act(() => {
		running = f.hook.result.current.newTerminal("workspace", "horizontal", {
			initialCommand: "printf once",
			label: "Agent",
		});
	});
	await waitFor(() =>
		expect(
			f.calls.filter((r) => r.path === "terminal.createSession"),
		).toHaveLength(1),
	);
	let flushed = false;
	const flushing = f.flush().then(() => {
		flushed = true;
	});
	try {
		await act(async () => {
			await Promise.resolve();
			await Promise.resolve();
		});
		expect(flushed).toBe(false);
	} finally {
		await act(async () => {
			release();
			await running;
			await flushing;
		});
	}
	expect(flushed).toBe(true);
	expect(f.saved().targets[0]?.workspaces[0]?.panes).toHaveLength(2);
	expect(
		f.calls.filter((r) => r.path === "terminal.createSession"),
	).toHaveLength(1);
});

test("an explicit new terminal tab runs only the original project trigger choices in bar order as fresh tabs", async () => {
	const presets = [
		{
			...scriptPreset("new-tab"),
			id: "global",
			commands: ["global"],
			applyOnNewTab: true,
			projectIds: null,
			tabOrder: 0,
		},
		{
			...scriptPreset("split-pane"),
			id: "later",
			name: "Later",
			commands: ["second"],
			applyOnNewTab: true,
			projectIds: ["project"],
			tabOrder: 9,
			pinnedToBar: false,
		},
		{
			...scriptPreset("sequential"),
			id: "first",
			name: "First",
			commands: ["first"],
			applyOnNewTab: true,
			projectIds: ["project"],
			tabOrder: 2,
		},
		{
			...scriptPreset("new-tab"),
			id: "other",
			commands: ["wrong project"],
			applyOnNewTab: true,
			projectIds: ["other-project"],
			tabOrder: 1,
		},
	];
	const f = fixture(true, undefined, presets);
	await waitFor(() => expect(f.hook.result.current.view?.revision).toBe(1));
	await act(async () =>
		f.hook.result.current.newTerminal("workspace", "horizontal", undefined, {
			placement: "new-tab",
		}),
	);
	const mutations = f.calls.filter((r) => r.type === "mutation");
	expect(
		mutations.map(
			(r) => (r.input as { initialCommand: string }).initialCommand,
		),
	).toEqual(["first", "second"]);
	expect(mutations.every((r) => r.path === "terminal.createSession")).toBe(
		true,
	);
	const w = f.saved().targets[0]!.workspaces[0]!;
	expect(w.panes[0]?.resourceId).toBe("retained");
	expect(w.paneTabs?.map((t) => t.label).slice(1)).toEqual(["First", "Later"]);
});

test("split and explicit agent launches do not evaluate new-tab triggers", async () => {
	const f = fixture(true, undefined, [
		{ ...scriptPreset("new-tab"), applyOnNewTab: true },
	]);
	await waitFor(() => expect(f.hook.result.current.view?.revision).toBe(1));
	await act(async () =>
		f.hook.result.current.newTerminal("workspace", "vertical"),
	);
	await act(async () =>
		f.hook.result.current.newTerminal(
			"workspace",
			"horizontal",
			{ initialCommand: "explicit agent", label: "Agent" },
			{ placement: "new-tab" },
		),
	);
	expect(
		f.calls.some(
			(r) => r.path === "settings.terminalPresets.catalogWithRevisionV1",
		),
	).toBe(false);
	expect(f.calls.filter((r) => r.type === "mutation")).toHaveLength(2);
});

test("an intentionally empty script catalog still opens one ordinary terminal without reseeding presets", async () => {
	const f = fixture(true, undefined, []);
	await waitFor(() => expect(f.hook.result.current.view?.revision).toBe(1));
	await act(async () =>
		f.hook.result.current.newTerminal("workspace", "horizontal", undefined, {
			placement: "new-tab",
		}),
	);
	expect(
		f.calls.filter((r) => r.type === "mutation").map((r) => r.path),
	).toEqual(["terminal.createSession"]);
	expect(
		f.calls.filter(
			(r) => r.path === "settings.terminalPresets.catalogWithRevisionV1",
		),
	).toHaveLength(1);
});

test("close waits for the trigger lookup and a target switch prevents all late trigger commands", async () => {
	const f = fixture(true, undefined, [
		{ ...scriptPreset("new-tab"), applyOnNewTab: true },
	]);
	await waitFor(() => expect(f.hook.result.current.view?.revision).toBe(1));
	const release = f.pauseCatalog();
	let run: Promise<unknown>,
		closed = false;
	act(() => {
		run = f.hook.result.current.newTerminal(
			"workspace",
			"horizontal",
			undefined,
			{ placement: "new-tab" },
		);
	});
	await waitFor(() =>
		expect(
			f.calls.some(
				(r) => r.path === "settings.terminalPresets.catalogWithRevisionV1",
			),
		).toBe(true),
	);
	const closing = f.flush().then(() => {
		closed = true;
	});
	await Promise.resolve();
	expect(closed).toBe(false);
	act(() => f.switchTarget());
	await act(async () => {
		release();
		await run;
		await closing;
	});
	expect(f.calls.filter((r) => r.type === "mutation")).toEqual([]);
	expect(closed).toBe(true);
});

test("workspace creation presets run only through their explicit trigger and never type into an existing terminal", async () => {
	const f = fixture(true, undefined, [
		{
			...scriptPreset("sequential"),
			applyOnWorkspaceCreated: true,
			commands: ["creation"],
		},
		{
			...scriptPreset("new-tab"),
			id: "empty",
			applyOnWorkspaceCreated: true,
			commands: [],
		},
	]);
	await waitFor(() => expect(f.hook.result.current.view?.revision).toBe(1));
	expect(f.calls).toEqual([]);
	await act(async () =>
		f.hook.result.current.runWorkspaceCreationPresets("workspace"),
	);
	const writes = f.calls.filter((r) => r.type === "mutation");
	expect(writes).toHaveLength(1);
	expect(writes[0]?.path).toBe("terminal.createSession");
	expect(writes[0]?.input).toMatchObject({ initialCommand: "creation" });
});

test("two new-tab clicks during a trigger lookup share one action and never create an extra shell", async () => {
	const f = fixture(true, undefined, [
		{ ...scriptPreset("sequential"), applyOnNewTab: true, commands: ["one"] },
	]);
	await waitFor(() => expect(f.hook.result.current.view?.revision).toBe(1));
	const release = f.pauseCatalog();
	let first: Promise<unknown>, second: Promise<unknown>;
	act(() => {
		first = f.hook.result.current.newTerminal(
			"workspace",
			"horizontal",
			undefined,
			{ placement: "new-tab" },
		);
		second = f.hook.result.current.newTerminal(
			"workspace",
			"horizontal",
			undefined,
			{ placement: "new-tab" },
		);
	});
	expect(second!).toBe(first!);
	await act(async () => {
		release();
		await first;
		await second;
	});
	expect(f.calls.filter((r) => r.type === "mutation")).toHaveLength(1);
});

test("a lost trigger creation response stops later presets without retrying the unresolved command", async () => {
	const errors: string[] = [];
	const f = fixture(true, (e) => errors.push(e), [
		{
			...scriptPreset("new-tab"),
			applyOnNewTab: true,
			commands: ["first"],
			tabOrder: 0,
		},
		{
			...scriptPreset("new-tab"),
			id: "next",
			applyOnNewTab: true,
			commands: ["must not start"],
			tabOrder: 1,
		},
	]);
	await waitFor(() => expect(f.hook.result.current.view?.revision).toBe(1));
	f.failCreate(1);
	await act(async () =>
		f.hook.result.current.newTerminal("workspace", "horizontal", undefined, {
			placement: "new-tab",
		}),
	);
	expect(f.calls.filter((r) => r.type === "mutation")).toHaveLength(1);
	expect(errors.some((e) => e.includes("Response lost"))).toBe(true);
	expect(f.saved().targets[0]?.workspaces[0]?.panes).toHaveLength(1);
});

test("a failed trigger catalog read keeps the requested action explicit and never substitutes a blank shell", async () => {
	const errors: string[] = [];
	const f = fixture(true, (e) => errors.push(e), []);
	await waitFor(() => expect(f.hook.result.current.view?.revision).toBe(1));
	f.failCatalog();
	await act(async () =>
		f.hook.result.current.newTerminal("workspace", "horizontal", undefined, {
			placement: "new-tab",
		}),
	);
	expect(f.calls.filter((r) => r.type === "mutation")).toEqual([]);
	expect(errors.some((e) => e.includes("Catalog unavailable"))).toBe(true);
});

test("a failed first preset layout save prevents later triggered launches", async () => {
	const errors: string[] = [];
	const f = fixture(true, (e) => errors.push(e), [
		{ ...scriptPreset("new-tab"), commands: ["first"], applyOnNewTab: true },
		{
			...scriptPreset("new-tab"),
			id: "later",
			commands: ["later"],
			applyOnNewTab: true,
			tabOrder: 1,
		},
	]);
	await waitFor(() => expect(f.hook.result.current.view?.revision).toBe(1));
	f.failLayoutSave();
	await act(async () =>
		f.hook.result.current.newTerminal("workspace", "horizontal", undefined, {
			placement: "new-tab",
		}),
	);
	expect(f.calls.filter((r) => r.type === "mutation")).toHaveLength(1);
	expect(errors.length).toBeGreaterThan(0);
});

test("linked trigger commands use the versioned selected backend agent catalog without legacy reseeding", async () => {
	const agent = {
		id: "agent",
		presetId: "custom",
		command: "/usr/bin/printf",
		args: ["linked 中文"],
		env: {},
	} as HostAgentConfig;
	const f = fixture(
		true,
		undefined,
		[
			{
				...scriptPreset("sequential"),
				agentId: "agent",
				applyOnNewTab: true,
				commands: ["old snapshot"],
			},
		],
		[agent],
	);
	await waitFor(() => expect(f.hook.result.current.view?.revision).toBe(1));
	await act(async () =>
		f.hook.result.current.newTerminal("workspace", "horizontal", undefined, {
			placement: "new-tab",
		}),
	);
	expect(f.calls.filter((r) => r.type === "mutation")[0]?.input).toMatchObject({
		initialCommand: "/usr/bin/printf 'linked 中文'",
	});
	expect(
		f.calls.some(
			(r) => r.path === "settings.agentConfigs.catalogWithRevisionV2",
		),
	).toBe(true);
	expect(f.calls.some((r) => r.path === "settings.agentConfigs.list")).toBe(
		false,
	);
});

test("a linked trigger on a backend without the V2 agent catalog cannot fall back to a reseeding read", async () => {
	const errors: string[] = [];
	const f = fixture(true, (e) => errors.push(e), [
		{ ...scriptPreset("sequential"), agentId: "agent", applyOnNewTab: true },
	]);
	await waitFor(() => expect(f.hook.result.current.view?.revision).toBe(1));
	await act(async () =>
		f.hook.result.current.newTerminal("workspace", "horizontal", undefined, {
			placement: "new-tab",
		}),
	);
	expect(f.calls.filter((r) => r.type === "mutation")).toEqual([]);
	expect(f.calls.some((r) => r.path === "settings.agentConfigs.list")).toBe(
		false,
	);
	expect(errors).toHaveLength(1);
});

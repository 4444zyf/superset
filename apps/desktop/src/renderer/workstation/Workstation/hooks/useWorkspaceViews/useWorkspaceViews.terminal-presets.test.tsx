import { afterEach, expect, test } from "bun:test";
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
function fixture(advertised: boolean) {
	const connection: DirectDescriptor = {
		connectionId: "ssh",
		backendId: "backend",
		namespaceId: "namespace",
		instanceId: "instance",
		generation: 2,
		capabilities: {
			durableOperations: true,
			terminals: true,
			workstationTerminalPresetsV1: advertised,
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
			throw new Error("must not reconnect");
		},
		rpc: async (r: DirectRpc) => {
			calls.push(r);
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
				throw new Error(message);
			},
		}),
	);
	return { hook, calls, saved: () => backing };
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

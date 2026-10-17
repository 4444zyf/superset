import { afterEach, expect, test } from "bun:test";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type {
	DirectDescriptor,
	DirectRpc,
	DirectWorkstationApi,
} from "../../../../../shared/direct-workstation";
import type { WorkspaceViewSnapshot } from "../../../../../shared/workspace-view";
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

import { afterEach, expect, test } from "bun:test";
import { TooltipProvider } from "@superset/ui/tooltip";
import {
	act,
	cleanup,
	fireEvent,
	render,
	waitFor,
} from "@testing-library/react";
import { DndProvider } from "react-dnd";
import { HTML5Backend } from "react-dnd-html5-backend";
import type {
	DirectDescriptor,
	DirectSocketEvent,
	DirectWorkstationApi,
} from "../../../../../../../shared/direct-workstation";
import type { WorkspaceView } from "../../../../../../../shared/workspace-view";
import type { WorkspaceViewActions } from "../../../../hooks/useWorkspaceViews/useWorkspaceViews";
import { PaneGrid } from "./PaneGrid";

afterEach(cleanup);

test("replacing a failed run resource in the same pane resets failure without creating a terminal", async () => {
	const connection: DirectDescriptor = {
		connectionId: "remote",
		backendId: "backend",
		namespaceId: "namespace",
		instanceId: "instance",
		generation: 1,
		capabilities: { workspaceViewRestoreV1: true, durableOperations: true },
	};
	const listeners = new Set<(event: DirectSocketEvent) => void>();
	const opened: { socketId: string; resourceId: string }[] = [];
	let mutations = 0;
	const api = {
		onSocket: (listener: (event: DirectSocketEvent) => void) => {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		openRestoredTerminal: async (
			_connection: unknown,
			ref: { resourceId: string },
			socketId: string,
		) => {
			opened.push({ socketId, resourceId: ref.resourceId });
		},
		sendSocket: async () => {},
		closeSocket: async () => {},
		rpc: async () => {
			mutations++;
			throw new Error("No create or other RPC is allowed");
		},
	} as unknown as DirectWorkstationApi;
	const actions = {
		busy: false,
		saveLayout() {},
		focusPane: async () => {},
		renamePane: async () => {},
		closePane: async () => {},
	} as unknown as WorkspaceViewActions;
	const fixture = (resourceId: string) => {
		const workspace: WorkspaceView = {
			tabId: "tab",
			workspaceId: "workspace",
			activeTool: "terminal",
			activePaneId: "console",
			panes: [
				{
					paneId: "console",
					kind: "terminal",
					resourceId,
					executionId: resourceId + "-execution",
				},
			],
			layout: { type: "pane", paneId: "console" },
		};
		return (
			<DndProvider backend={HTML5Backend}>
				<TooltipProvider>
					<PaneGrid
						api={api}
						connection={connection}
						workspace={workspace}
						checks={[
							{
								workspaceId: "workspace",
								kind: "terminal",
								resourceId,
								executionId: resourceId + "-execution",
								state: "live",
							},
						]}
						actions={actions}
						createEmulator={() => ({
							terminal: {
								cols: 80,
								rows: 24,
								write() {},
								writeln() {},
								onData() {
									return { dispose() {} };
								},
								onResize() {
									return { dispose() {} };
								},
								dispose() {},
							},
							fit() {},
						})}
					/>
				</TooltipProvider>
			</DndProvider>
		);
	};
	const view = render(fixture("old"));
	await waitFor(() => expect(opened).toHaveLength(1));
	await act(async () => {
		for (const listener of listeners)
			listener({
				socketId: opened[0]!.socketId,
				kind: "message",
				data: JSON.stringify({ type: "error", code: "EXECUTION_CHANGED" }),
			});
	});
	await waitFor(() =>
		expect(
			view.container
				.querySelector('[data-pane-id="console"]')
				?.getAttribute("data-resource-state"),
		).toBe("unknown"),
	);
	view.rerender(fixture("new"));
	await waitFor(() => expect(opened).toHaveLength(2));
	expect(opened[1]?.resourceId).toBe("new");
	expect(mutations).toBe(0);
});

test("original terminal tabs switch the visible group and persist metadata without creating a session", async () => {
	const workspace: WorkspaceView = {
		workspaceId: "workspace",
		tabId: "workspace-tab",
		activeTool: "terminal",
		activePaneId: "a",
		panes: [
			{
				paneId: "a",
				kind: "terminal",
				resourceId: "session-a",
				executionId: "execution-a",
				label: "First pane",
			},
			{
				paneId: "b",
				kind: "terminal",
				resourceId: "session-b",
				executionId: "execution-b",
				label: "Second pane",
			},
		],
		layout: {
			type: "split",
			axis: "horizontal",
			ratio: 0.5,
			first: { type: "pane", paneId: "a" },
			second: { type: "pane", paneId: "b" },
		},
		paneTabs: [
			{
				tabId: "first",
				label: "First group",
				createdAt: 1,
				activePaneId: "a",
				layout: { type: "pane", paneId: "a" },
			},
			{
				tabId: "second",
				label: "Second group",
				createdAt: 2,
				activePaneId: "b",
				layout: { type: "pane", paneId: "b" },
			},
		],
		activePaneTabId: "first",
	};
	const saves: { workspaceId: string; activeTabId: string | null }[] = [];
	let rpc = 0;
	const actions = {
		busy: false,
		saveLayout() {},
		focusPane: async () => {},
		renamePane: async () => {},
		closePane: async () => {},
		savePaneState: async (
			workspaceId: string,
			state: { activeTabId: string | null },
		) => {
			saves.push({ workspaceId, activeTabId: state.activeTabId });
		},
	} as unknown as WorkspaceViewActions;
	const api = {
		rpc: async () => {
			rpc++;
			throw new Error("No resource RPC expected");
		},
	} as unknown as DirectWorkstationApi;
	const view = render(
		<DndProvider backend={HTML5Backend}>
			<TooltipProvider>
				<PaneGrid
					api={api}
					workspace={workspace}
					connection={null}
					checks={[]}
					actions={actions}
				/>
			</TooltipProvider>
		</DndProvider>,
	);
	await waitFor(() =>
		expect(view.container.querySelectorAll("[data-tab-id]")).toHaveLength(2),
	);
	const second = view.container.querySelector('[data-tab-id="second"]');
	if (!second) throw new Error("missing original tab");
	fireEvent.click(second);
	await waitFor(() =>
		expect(saves).toEqual([
			{ workspaceId: "workspace", activeTabId: "second" },
		]),
	);
	expect(Boolean(view.container.querySelector('[data-pane-id="b"]'))).toBe(
		true,
	);
	expect(Boolean(view.container.querySelector('[data-pane-id="a"]'))).toBe(
		false,
	);
	expect(rpc).toBe(0);
});

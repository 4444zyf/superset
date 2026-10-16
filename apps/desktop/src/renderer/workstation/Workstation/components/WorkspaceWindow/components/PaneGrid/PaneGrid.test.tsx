import { afterEach, expect, test } from "bun:test";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { TooltipProvider } from "@superset/ui/tooltip";
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

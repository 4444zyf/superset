import { afterEach, expect, test } from "bun:test";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { TooltipProvider } from "@superset/ui/tooltip";
import { DndProvider } from "react-dnd";
import { HTML5Backend } from "react-dnd-html5-backend";
import type { ComponentProps } from "react";
import { WorkspaceWindow } from "./WorkspaceWindow";
afterEach(cleanup);
test("loading Run state does not insert an action before New terminal", async () => {
	let resolve!: (value: unknown) => void;
	const props = {
		api: {
			rpc: () =>
				new Promise((r) => {
					resolve = r;
				}),
		},
		connection: {
			connectionId: "remote",
			generation: 1,
			backendId: "backend",
			namespaceId: "namespace",
			instanceId: "instance",
			capabilities: {
				workspaceViewRestoreV1: true,
				workstationWorkspaceRunV1: true,
				durableOperations: true,
				terminals: true,
			},
		},
		target: {
			connectionId: "remote",
			targetRevision: 1,
			backendId: "backend",
			namespaceId: "namespace",
			serviceUid: 1000,
			autoConnect: true,
			activeTabId: "tab",
			workspaces: [
				{
					tabId: "tab",
					workspaceId: "workspace",
					label: "Example",
					activeTool: "terminal",
					activePaneId: null,
					panes: [],
					layout: null,
				},
			],
		},
		checks: [],
		resourceRevision: 0,
		restore: null,
		actions: { busy: false },
		onNewSession() {},
		onRefresh() {},
		onPending() {},
		onProjectSettings() {},
		ports: { busy: false, forward: null, onOpen() {}, onClose() {} },
		onBrowse() {},
		onMachines() {},
		onError() {},
	} as unknown as ComponentProps<typeof WorkspaceWindow>;
	const view = render(
		<DndProvider backend={HTML5Backend}>
			<TooltipProvider>
				<WorkspaceWindow {...props} />
			</TooltipProvider>
		</DndProvider>,
	);
	const first = () =>
		view.container
			.querySelectorAll(".ws-window-toolbar")[1]
			?.querySelector("button")
			?.textContent?.trim();
	expect(first()).toBe("New terminal");
	await waitFor(() => expect(typeof resolve).toBe("function"));
	await act(async () =>
		resolve({
			projectId: "project",
			definition: null,
			definitionVersion: null,
			definitionError: null,
			run: null,
		}),
	);
	expect(first()).toBe("New terminal");
});

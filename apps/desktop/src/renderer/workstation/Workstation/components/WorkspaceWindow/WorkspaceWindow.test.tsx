import { afterEach, expect, test } from "bun:test";
import { TooltipProvider } from "@superset/ui/tooltip";
import {
	act,
	cleanup,
	fireEvent,
	render,
	waitFor,
} from "@testing-library/react";
import type { ComponentProps } from "react";
import { DndProvider } from "react-dnd";
import { HTML5Backend } from "react-dnd-html5-backend";
import { WorkspaceWindow } from "./WorkspaceWindow";

afterEach(cleanup);
test("Run attaches in an original dedicated tab and reuses the prior Run resource on restart", async () => {
	const attachments: unknown[][] = [];
	const connection = {
		connectionId: "remote",
		backendId: "backend",
		namespaceId: "namespace",
		instanceId: "instance",
		generation: 1,
		capabilities: { workstationWorkspaceRunV1: true, durableOperations: true },
	};
	const props = {
		api: {
			rpc: async () => ({
				projectId: "project",
				definition: null,
				definitionVersion: null,
				definitionError: null,
				run: {
					workspaceId: "workspace",
					operationId: "run",
					terminalId: "run-terminal",
					previousTerminalId: "previous-run",
					executionId: "execution",
					state: "active",
					commands: ["echo run"],
					foregroundSeen: true,
					startedAt: 1,
				},
			}),
		},
		connection,
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
		actions: {
			busy: false,
			addPane: async (...args: unknown[]) => {
				attachments.push(args);
			},
		},
		ports: { busy: false, forward: null, onOpen() {}, onClose() {} },
		onNewSession() {},
		onRefresh() {},
		onPending() {},
		onProjectSettings() {},
		onBrowse() {},
		onMachines() {},
		onError() {},
	} as unknown as ComponentProps<typeof WorkspaceWindow>;
	render(
		<DndProvider backend={HTML5Backend}>
			<TooltipProvider>
				<WorkspaceWindow {...props} />
			</TooltipProvider>
		</DndProvider>,
	);
	await waitFor(() => expect(attachments).toHaveLength(1));
	expect(attachments[0]?.[3]).toMatchObject({
		connection,
		newTab: true,
		replaceResourceId: "previous-run",
	});
});
test("loading Run state does not insert an action before New terminal", async () => {
	let resolve!: (value: unknown) => void;
	const terminals: unknown[][] = [];
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
		actions: {
			busy: false,
			newTerminal: (...args: unknown[]) => {
				terminals.push(args);
			},
		},
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
	const button = view.container
		.querySelectorAll(".ws-window-toolbar")[1]
		?.querySelector("button");
	if (!button) throw new Error("Missing New terminal action");
	fireEvent.click(button);
	expect(terminals).toEqual([
		["workspace", "horizontal", undefined, { placement: "new-tab" }],
	]);
});

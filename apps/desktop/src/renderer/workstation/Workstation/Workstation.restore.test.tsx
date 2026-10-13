import { afterEach, expect, test } from "bun:test";
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import type { DirectWorkstationApi } from "../../../shared/direct-workstation";
import type { WorkspaceViewSnapshot } from "../../../shared/workspace-view";
import { Workstation } from "./Workstation";

afterEach(cleanup);
test("offline startup keeps all three saved panes, ratios and focus without ordinary connection or mutations", async () => {
	const calls: string[] = [];
	const snapshot: WorkspaceViewSnapshot = {
		schemaVersion: 1,
		revision: 1,
		updatedAt: 1,
		restoreOnLaunch: true,
		activeConnectionId: "mac",
		window: { x: 0, y: 0, width: 1280, height: 850, maximized: false },
		targets: [
			{
				connectionId: "mac",
				targetRevision: 1,
				backendId: "backend",
				namespaceId: "namespace",
				serviceUid: 501,
				autoConnect: true,
				activeTabId: "tab",
				workspaces: [
					{
						tabId: "tab",
						workspaceId: "workspace",
						label: "Saved workspace",
						activeTool: "terminal",
						activePaneId: "codex",
						panes: ["claude", "codex", "omp"].map((paneId) => ({
							paneId,
							kind: "terminal",
							resourceId: paneId,
							executionId: `${paneId}-execution`,
							label: paneId,
						})),
						layout: {
							type: "split",
							axis: "horizontal",
							ratio: 0.37,
							first: { type: "pane", paneId: "claude" },
							second: {
								type: "split",
								axis: "vertical",
								ratio: 0.64,
								first: { type: "pane", paneId: "codex" },
								second: { type: "pane", paneId: "omp" },
							},
						},
					},
				],
			},
		],
	};
	const api = {
		platform: "darwin",
		list: async () => [{ id: "mac", name: "Mac", host: "mini" }],
		getWorkspaceView: async () => ({
			snapshot,
			revision: 1,
			invalid: false,
			navigationRevision: 0,
		}),
		saveWorkspaceView: async () => {
			calls.push("unexpected-save");
			throw new Error("Unexpected write");
		},
		onWorkspaceRestore: () => () => {},
		beginWorkspaceRestore: async () => {
			calls.push("existing-restore");
			return {
				jobId: "job",
				generation: 1,
				sequence: 1,
				viewRevision: 1,
				navigationRevision: 0,
				connectionId: "mac",
				status: "paused",
				reason: "unavailable",
				resources: [],
			};
		},
		connect: async () => {
			calls.push("ordinary-connect");
			throw new Error("Unexpected installation path");
		},
		rpc: async () => {
			calls.push("unexpected-rpc");
			return [];
		},
	} as unknown as DirectWorkstationApi;
	const ui = render(<Workstation api={api} />);
	await waitFor(() =>
		expect(ui.container.querySelectorAll("[data-pane-id]")).toHaveLength(3),
	);
	expect(
		ui.container
			.querySelector('[data-split-path=""]')
			?.getAttribute("data-split-percentage"),
	).toBe("37");
	expect(
		ui.container
			.querySelector('[data-split-path="second"]')
			?.getAttribute("data-split-percentage"),
	).toBe("64");
	expect(
		ui.container
			.querySelector('[data-pane-id="codex"]')
			?.getAttribute("data-active"),
	).toBe("true");
	expect(calls).toEqual(["existing-restore"]);
});

test("the SSH window feature leaves local workspace opening on its existing path", async () => {
	let captures = 0;
	const id = "00000000-0000-4000-8000-000000000001";
	const api = {
		platform: "linux",
		list: async () => [
			{ id, kind: "local", name: "Local Device", host: "localhost" },
		],
		getWorkspaceView: async () => ({
			snapshot: null,
			revision: 0,
			invalid: false,
			navigationRevision: 0,
		}),
		saveWorkspaceView: async (input: { view: unknown }) => {
			captures++;
			return {
				...(input.view as object),
				schemaVersion: 1,
				revision: 1,
				updatedAt: 1,
			};
		},
		onWorkspaceRestore: () => () => {},
		beginWorkspaceRestore: async () => {
			throw new Error("No automatic local start");
		},
		connect: async () => ({
			connectionId: id,
			generation: 1,
			backendId: "backend",
			namespaceId: "namespace",
			instanceId: "instance",
			capabilities: { workspaceViewRestoreV1: true },
		}),
		rpc: async (request: { path: string }) =>
			request.path === "workspace.list"
				? [
						{
							id: "local-workspace",
							name: "Local workspace",
							worktreePath: "/tmp/local",
						},
					]
				: request.path === "terminal.list"
					? { sessions: [] }
					: [],
	} as unknown as DirectWorkstationApi;
	render(<Workstation api={api} />);
	fireEvent.click(await screen.findByRole("button", { name: "Connect" }));
	fireEvent.click(
		await screen.findByRole("button", { name: "Local workspace" }),
	);
	await screen.findByRole("heading", { name: "Local workspace" });
	expect(captures).toBe(0);
});

test("a newly created SSH workspace opens its saved tab before the refreshed list has rendered", async () => {
	let saved: WorkspaceViewSnapshot | null = null;
	const workspace = {
		id: "new-workspace",
		name: "New SSH workspace",
		worktreePath: "/tmp/new-workspace",
	};
	const api = {
		platform: "darwin",
		list: async () => [{ id: "mac", name: "Mac", host: "mini" }],
		getWorkspaceView: async () => ({
			snapshot: saved,
			revision: saved?.revision ?? 0,
			invalid: false,
			navigationRevision: 0,
		}),
		saveWorkspaceView: async (input: { view: object }) => {
			saved = {
				...input.view,
				schemaVersion: 1,
				revision: 1,
				updatedAt: 1,
			} as WorkspaceViewSnapshot;
			return saved;
		},
		connect: async () => ({
			connectionId: "mac",
			generation: 1,
			backendId: "backend",
			namespaceId: "namespace",
			instanceId: "instance",
			capabilities: {
				workspaceViewRestoreV1: true,
				durableOperations: true,
				sessions: true,
			},
		}),
		beginWorkspaceRestore: async () => {
			throw new Error("No automatic new connection");
		},
		rpc: async (request: { path: string }) =>
			request.path === "workspaces.createSession"
				? { workspace }
				: request.path === "terminal.list"
					? { sessions: [] }
					: [],
	} as unknown as DirectWorkstationApi;
	const view = render(<Workstation api={api} />);
	fireEvent.click(await screen.findByRole("button", { name: "Connect" }));
	fireEvent.click(
		(await screen.findAllByRole("button", { name: "New session" }))[0]!,
	);
	fireEvent.change(screen.getByRole("textbox", { name: "Name" }), {
		target: { value: "New SSH workspace" },
	});
	fireEvent.click(screen.getByRole("button", { name: "Create" }));
	await waitFor(() =>
		expect(
			view.container.querySelector(
				'.ws-workspace-tabs [data-tab-id][data-active="true"]',
			)?.textContent,
		).toBe("New SSH workspace"),
	);
	expect(
		(await api.getWorkspaceView!()).snapshot?.targets[0]?.workspaces[0]
			?.workspaceId,
	).toBe("new-workspace");
});

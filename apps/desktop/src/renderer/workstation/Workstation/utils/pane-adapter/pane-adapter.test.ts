import { expect, test } from "bun:test";
import { createWorkspaceStore } from "@superset/panes";
import type { WorkspaceView } from "../../../../../shared/workspace-view";
import { fromPaneLayout, toPaneState } from "./pane-adapter";

test("upstream pane moves and resize preserve remote execution references", () => {
	const view: WorkspaceView = {
		tabId: "tab",
		workspaceId: "workspace",
		activeTool: "terminal",
		activePaneId: "a",
		panes: [
			{
				paneId: "a",
				kind: "terminal",
				resourceId: "session-a",
				executionId: "execution-a",
				label: "Claude",
			},
			{
				paneId: "b",
				kind: "terminal",
				resourceId: "session-b",
				executionId: "execution-b",
				label: "Codex",
			},
		],
		layout: {
			type: "split",
			axis: "horizontal",
			ratio: 0.37,
			first: { type: "pane", paneId: "a" },
			second: { type: "pane", paneId: "b" },
		},
	};
	const store = createWorkspaceStore({ initialState: toPaneState(view) });
	expect(fromPaneLayout(store.getState().tabs[0]!.layout)).toEqual(
		view.layout!,
	);
	store
		.getState()
		.resizeSplit({ tabId: "tab", path: [], splitPercentage: 150 });
	expect(fromPaneLayout(store.getState().tabs[0]!.layout)).toMatchObject({
		ratio: 0.9,
	});
	store.getState().movePaneToSplit({
		sourcePaneId: "b",
		targetPaneId: "a",
		position: "bottom",
	});
	expect(fromPaneLayout(store.getState().tabs[0]!.layout)).toMatchObject({
		axis: "vertical",
	});
	expect(store.getState().getPane("a")?.pane.data).toEqual(view.panes[0]);
	expect(view.layout).toMatchObject({ ratio: 0.37 });
});

test("empty workspace remains empty without creating a terminal", () => {
	expect(
		toPaneState({
			tabId: "tab",
			workspaceId: "workspace",
			activeTool: "terminal",
			activePaneId: null,
			panes: [],
			layout: null,
		}).tabs,
	).toEqual([]);
});

test("restored terminal tabs use the original pane store without merging their layouts", () => {
	const workspace = {
		tabId: "workspace-tab",
		workspaceId: "workspace",
		activeTool: "terminal" as const,
		activePaneId: "b",
		panes: [
			{
				paneId: "a",
				kind: "terminal" as const,
				resourceId: "session-a",
				executionId: "execution-a",
				label: "Claude",
			},
			{
				paneId: "b",
				kind: "terminal" as const,
				resourceId: "session-b",
				executionId: "execution-b",
				label: "Codex",
			},
		],
		layout: {
			type: "split" as const,
			axis: "horizontal" as const,
			ratio: 0.5,
			first: { type: "pane" as const, paneId: "a" },
			second: { type: "pane" as const, paneId: "b" },
		},
		activePaneTabId: "terminal-b",
		paneTabs: [
			{
				tabId: "terminal-a",
				label: "First",
				createdAt: 10,
				activePaneId: "a",
				layout: { type: "pane" as const, paneId: "a" },
			},
			{
				tabId: "terminal-b",
				label: "Second",
				createdAt: 20,
				activePaneId: "b",
				layout: { type: "pane" as const, paneId: "b" },
			},
		],
	};
	const state = toPaneState(workspace);
	expect(state.activeTabId).toBe("terminal-b");
	expect(
		state.tabs.map((tab) => ({
			id: tab.id,
			title: tab.titleOverride,
			createdAt: tab.createdAt,
			paneIds: Object.keys(tab.panes),
		})),
	).toEqual([
		{ id: "terminal-a", title: "First", createdAt: 10, paneIds: ["a"] },
		{ id: "terminal-b", title: "Second", createdAt: 20, paneIds: ["b"] },
	]);
	const store = createWorkspaceStore({ initialState: state });
	store.getState().setActiveTab("terminal-a");
	expect(store.getState().getActivePane()?.pane.data).toEqual(
		workspace.panes[0],
	);
	expect(store.getState().getPane("b")?.pane.data).toEqual(workspace.panes[1]);
});

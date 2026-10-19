import { expect, test } from "bun:test";
import { createWorkspaceStore } from "@superset/panes";
import type { WorkspaceView } from "../../../../../shared/workspace-view";
import { toPaneState } from "../pane-adapter/pane-adapter";
import { applyWorkspacePaneState } from "./workspace-pane-state";

function fixture(): WorkspaceView {
	return {
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
				label: "First",
			},
			{
				paneId: "b",
				kind: "terminal",
				resourceId: "session-b",
				executionId: "execution-b",
				label: "Second",
			},
		],
		layout: {
			type: "split",
			axis: "horizontal",
			ratio: 0.37,
			first: { type: "pane", paneId: "a" },
			second: { type: "pane", paneId: "b" },
		},
		paneTabs: [
			{
				tabId: "terminals",
				createdAt: 10,
				activePaneId: "a",
				layout: {
					type: "split",
					axis: "horizontal",
					ratio: 0.37,
					first: { type: "pane", paneId: "a" },
					second: { type: "pane", paneId: "b" },
				},
			},
		],
		activePaneTabId: "terminals",
	};
}
test("original pane-to-tab movement preserves each remote resource and execution ID", () => {
	const workspace = fixture(),
		before = toPaneState(workspace),
		store = createWorkspaceStore({ initialState: before });
	store.getState().movePaneToNewTab({ paneId: "b" });
	expect(applyWorkspacePaneState(workspace, store.getState(), before)).toBe(
		true,
	);
	expect(workspace.paneTabs).toHaveLength(2);
	expect(workspace.panes).toEqual(fixture().panes);
	expect(workspace.activePaneId).toBe("b");
	expect(workspace.activePaneTabId).not.toBe("terminals");
	expect(workspace.paneTabs?.[0]?.layout).toEqual({
		type: "pane",
		paneId: "a",
	});
});
test("original tab and pane rename, focus and split operations persist their display state", () => {
	const workspace = fixture(),
		before = toPaneState(workspace),
		store = createWorkspaceStore({ initialState: before });
	store.getState().setTabTitleOverride({
		tabId: "terminals",
		titleOverride: "Renamed group",
	});
	store.getState().setPaneTitleOverride({
		tabId: "terminals",
		paneId: "b",
		titleOverride: "Renamed terminal",
	});
	store.getState().setActivePane({ tabId: "terminals", paneId: "b" });
	store
		.getState()
		.resizeSplit({ tabId: "terminals", path: [], splitPercentage: 62 });
	expect(applyWorkspacePaneState(workspace, store.getState(), before)).toBe(
		true,
	);
	expect(workspace.paneTabs?.[0]).toMatchObject({
		label: "Renamed group",
		activePaneId: "b",
		layout: { ratio: 0.62 },
	});
	expect(workspace.panes[1]?.label).toBe("Renamed terminal");
});
test("closing the final original tab clears the view without issuing any resource operation", () => {
	const workspace = fixture(),
		before = toPaneState(workspace),
		store = createWorkspaceStore({ initialState: before });
	store.getState().removeTab("terminals");
	expect(applyWorkspacePaneState(workspace, store.getState(), before)).toBe(
		true,
	);
	expect(workspace.paneTabs).toEqual([]);
	expect(workspace.panes).toEqual([]);
	expect(workspace.activePaneTabId).toBeNull();
	expect(workspace.activePaneId).toBeNull();
	expect(workspace.layout).toBeNull();
});
test("late layout metadata cannot replace a newer execution", () => {
	const workspace = fixture(),
		before = toPaneState(workspace),
		store = createWorkspaceStore({ initialState: before });
	store
		.getState()
		.setTabTitleOverride({ tabId: "terminals", titleOverride: "Late title" });
	workspace.panes[0]!.executionId = "new-execution";
	const current = structuredClone(workspace);
	expect(applyWorkspacePaneState(workspace, store.getState(), before)).toBe(
		false,
	);
	expect(workspace).toEqual(current);
});
test("stale tab metadata cannot overwrite a newer saved title", () => {
	const workspace = fixture(),
		before = toPaneState(workspace),
		store = createWorkspaceStore({ initialState: before });
	store
		.getState()
		.setTabTitleOverride({ tabId: "terminals", titleOverride: "Old client" });
	workspace.paneTabs![0]!.label = "New client";
	const current = structuredClone(workspace);
	expect(applyWorkspacePaneState(workspace, store.getState(), before)).toBe(
		false,
	);
	expect(workspace).toEqual(current);
});
test("a foreign resource, duplicate pane, or incomplete group layout is rejected atomically", () => {
	for (const corrupt of ["foreign", "duplicate", "missing-layout-pane"]) {
		const workspace = fixture(),
			before = toPaneState(workspace),
			after = structuredClone(before);
		const group = after.tabs[0]!;
		if (corrupt === "foreign")
			group.panes.a!.data.resourceId = "foreign-session";
		if (corrupt === "duplicate")
			after.tabs.push({ ...structuredClone(group), id: "duplicate-group" });
		if (corrupt === "missing-layout-pane")
			group.layout = { type: "pane", paneId: "a" };
		expect(applyWorkspacePaneState(workspace, after, before)).toBe(false);
		expect(workspace).toEqual(fixture());
	}
});

test("a delayed rename preserves a newer focus and a delayed focus preserves a newer rename", () => {
	const workspace = fixture(),
		before = toPaneState(workspace),
		rename = createWorkspaceStore({ initialState: before });
	rename.getState().setPaneTitleOverride({
		tabId: "terminals",
		paneId: "a",
		titleOverride: "Typed title",
	});
	if(workspace.paneTabs?.[0]?.layout.type==="split")workspace.paneTabs[0].layout.ratio=0.62;
	workspace.activePaneId = "b";
	workspace.paneTabs![0]!.activePaneId = "b";
	expect(applyWorkspacePaneState(workspace, rename.getState(), before)).toBe(
		true,
	);
	expect(workspace.activePaneId).toBe("b");
	expect(workspace.panes[0]?.label).toBe("Typed title");
	expect(workspace.paneTabs?.[0]?.layout).toMatchObject({ratio:0.62});
	const focus = createWorkspaceStore({ initialState: before });
	focus.getState().setActivePane({ tabId: "terminals", paneId: "b" });
	expect(applyWorkspacePaneState(workspace, focus.getState(), before)).toBe(
		true,
	);
	expect(workspace.panes[0]?.label).toBe("Typed title");
	expect(workspace.activePaneId).toBe("b");
});

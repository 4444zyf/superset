import { expect, test } from "bun:test";
import type { WorkspaceViewInputV2 } from "../../../shared/workspace-view-v2";
import { projectWorkspaceViewV2 } from "../../../shared/workspace-view-v3";
import {
	fixture,
	required,
	workspace,
} from "./workspace-view-area-fixtures.test-data";
import { mergeLegacyWorkspaceViewAreas } from "./workspace-view-area-merge";

test("an unchanged legacy projection preserves both area selections and explicit pinned false", () => {
	const previous = fixture(),
		incoming = projectWorkspaceViewV2(previous);
	expect(mergeLegacyWorkspaceViewAreas(previous, incoming)).toEqual(previous);
	expect(previous).toEqual(fixture());
	expect(incoming).toEqual(projectWorkspaceViewV2(previous));
});
test("a legacy save does not reveal a hidden right pane merely because the center is empty", () => {
	const previous = fixture(),
		w = workspace(previous),
		right = required(w.rightPaneLayout);
	right.tabs.push(...required(w.paneTabs));
	w.paneTabs = [];
	w.activePaneTabId = null;
	w.activePaneId = null;
	const incoming = projectWorkspaceViewV2(previous);
	expect(workspace(incoming).activePaneId).toBe("browser");
	expect(mergeLegacyWorkspaceViewAreas(previous, incoming)).toEqual(previous);
});
test("a changed legacy selection reveals and focuses the right area while retaining the center tab", () => {
	const previous = fixture(),
		incoming = projectWorkspaceViewV2(previous),
		w = workspace(incoming);
	w.activePaneId = "browser";
	w.activePaneTabId = "right-tab";
	const saved = workspace(mergeLegacyWorkspaceViewAreas(previous, incoming));
	expect(saved.activePaneArea).toBe("right");
	expect(saved.rightPaneOpen).toBe(true);
	expect(saved.activePaneTabId).toBe("center-tab");
	expect(saved.activePaneId).toBe("browser");
});
test("ordinary label, page and window edits preserve area and resource metadata", () => {
	const previous = fixture(),
		incoming = projectWorkspaceViewV2(previous),
		w = workspace(incoming);
	incoming.window.width = 1000;
	w.label = "工作区";
	required(w.paneTabs?.[1]).label = "右侧";
	const browser = w.panes.find((p) => p.kind === "browser");
	if (browser?.kind !== "browser") throw Error("Missing browser");
	browser.browser.pageTitle = "新的页面";
	const saved = mergeLegacyWorkspaceViewAreas(previous, incoming);
	expect(saved.window.width).toBe(1000);
	expect(workspace(saved).label).toBe("工作区");
	expect(workspace(saved).rightPaneLayout?.tabs[0]?.label).toBe("右侧");
	expect(workspace(saved).panes.map((p) => p.pinned)).toEqual([true, false]);
	expect(projectWorkspaceViewV2(saved)).toEqual(incoming);
});
test("removed legacy resources are removed without recreating a right tab", () => {
	const previous = fixture(),
		incoming = projectWorkspaceViewV2(previous),
		w = workspace(incoming);
	w.panes = w.panes.filter((p) => p.paneId === "terminal");
	w.paneTabs = required(w.paneTabs).filter((t) => t.tabId === "center-tab");
	w.layout = { type: "pane", paneId: "terminal" };
	const saved = workspace(mergeLegacyWorkspaceViewAreas(previous, incoming));
	expect(saved.panes).toHaveLength(1);
	expect(saved.rightPaneLayout).toEqual({
		version: 1,
		tabs: [],
		activeTabId: null,
	});
	expect(saved.panes[0]?.pinned).toBe(true);
});
test("new tabs containing only previous right panes remain in that area", () => {
	const previous = fixture(),
		incoming = projectWorkspaceViewV2(previous);
	required(workspace(incoming).paneTabs?.[1]).tabId = "replacement-right-tab";
	const saved = workspace(mergeLegacyWorkspaceViewAreas(previous, incoming));
	expect(saved.rightPaneLayout?.activeTabId).toBe("replacement-right-tab");
	expect(saved.paneTabs?.map((t) => t.tabId)).toEqual(["center-tab"]);
	expect(saved.rightPaneOpen).toBe(false);
});
test("merging into an existing destination tab keeps every pane in that destination area once", () => {
	const previous = fixture(),
		incoming = projectWorkspaceViewV2(previous),
		w = workspace(incoming);
	const right = required(w.paneTabs?.[1]);
	right.layout = required(w.layout);
	w.paneTabs = [right];
	w.activePaneId = "browser";
	w.activePaneTabId = right.tabId;
	const saved = workspace(mergeLegacyWorkspaceViewAreas(previous, incoming));
	expect(saved.paneTabs).toEqual([]);
	expect(saved.rightPaneLayout?.tabs).toHaveLength(1);
	expect(saved.panes.map((p) => p.resourceId)).toEqual([
		"pty",
		"browser-resource",
	]);
	expect(saved.activePaneArea).toBe("right");
});
test("pin state is not inherited when a pane id is rebound to another execution or resource", () => {
	const previous = fixture(),
		incoming = projectWorkspaceViewV2(previous);
	required(workspace(incoming).panes[0]).executionId = "replacement-execution";
	const saved = workspace(mergeLegacyWorkspaceViewAreas(previous, incoming));
	expect(saved.panes[0]?.pinned).toBeUndefined();
	expect(saved.panes[1]?.pinned).toBe(false);
});
test("an existing area's metadata cannot cross a backend identity change", () => {
	for (const key of ["backendId", "namespaceId", "serviceUid"] as const) {
		const previous = fixture(),
			incoming = projectWorkspaceViewV2(previous),
			target = required(incoming.targets[0]);
		if (key === "serviceUid") target[key]++;
		else target[key] = "foreign";
		expect(() => mergeLegacyWorkspaceViewAreas(previous, incoming)).toThrow(
			"Workspace identity requires V3",
		);
	}
});
test("another connection and unextended legacy workspaces do not acquire area metadata", () => {
	const previous = fixture(),
		incoming = projectWorkspaceViewV2(previous),
		target = required(incoming.targets[0]);
	target.connectionId = "other";
	incoming.activeConnectionId = "other";
	expect(mergeLegacyWorkspaceViewAreas(previous, incoming)).toEqual(incoming);
	const legacy: WorkspaceViewInputV2 = projectWorkspaceViewV2(fixture());
	expect(mergeLegacyWorkspaceViewAreas(legacy, legacy)).toEqual(legacy);
});

import { expect, test } from "bun:test";
import { transferPaneToSplit, transferTabToIndex } from "@superset/panes";
import {
	fixture,
	required,
	workspace,
} from "../../../../../main/lib/ssh-direct/workspace-view-area-fixtures.test-data";
import {
	validateWorkspaceViewV3,
	type WorkspaceViewInputV3,
} from "../../../../../shared/workspace-view-v3";
import {
	createWorkspacePaneAreas,
	workspacePaneAreasMetadataKey,
} from "./workspace-pane-areas";
import {
	applyWorkspacePaneAreas,
	type WorkspacePaneAreasScope,
} from "./workspace-pane-areas-state";

function scope(view: WorkspaceViewInputV3): WorkspacePaneAreasScope {
	const t = required(view.targets[0]),
		w = workspace(view);
	return {
		connectionId: t.connectionId,
		backendId: t.backendId,
		namespaceId: t.namespaceId,
		targetRevision: t.targetRevision,
		serviceUid: t.serviceUid,
		workspaceId: w.workspaceId,
		tabId: w.tabId,
	};
}
function edit(
	change: (areas: ReturnType<typeof createWorkspacePaneAreas>) => void,
	view = fixture(),
) {
	const areas = createWorkspacePaneAreas(workspace(view), {
		scheduleMicrotask: () => {},
	});
	try {
		const before = areas.read();
		change(areas);
		return { source: view, scope: scope(view), before, next: areas.read() };
	} finally {
		areas.dispose();
	}
}
function multiTabFixture(): WorkspaceViewInputV3 {
	const view = fixture(),
		w = workspace(view);
	w.panes.push(
		{ paneId: "chat", kind: "chat", resourceId: "chat-resource" },
		{
			paneId: "right-terminal",
			kind: "terminal",
			resourceId: "right-pty",
			executionId: "right-execution",
		},
	);
	w.layout = {
		type: "split",
		axis: "horizontal",
		ratio: 0.5,
		first: required(w.layout),
		second: {
			type: "split",
			axis: "vertical",
			ratio: 0.5,
			first: { type: "pane", paneId: "chat" },
			second: { type: "pane", paneId: "right-terminal" },
		},
	};
	required(w.paneTabs).push({
		tabId: "chat-tab",
		createdAt: 3,
		activePaneId: "chat",
		layout: { type: "pane", paneId: "chat" },
	});
	required(w.rightPaneLayout).tabs.push({
		tabId: "right-terminal-tab",
		createdAt: 4,
		activePaneId: "right-terminal",
		layout: { type: "pane", paneId: "right-terminal" },
	});
	return validateWorkspaceViewV3(view);
}
test("an original tab transfer persists both areas and keeps each resource and pin once", () => {
	const e = edit((areas) => {
		transferTabToIndex({
			source: areas.center,
			target: areas.right,
			tabId: "center-tab",
		});
		areas.activate("right");
	});
	const saved = workspace(
		required(applyWorkspacePaneAreas(e.source, e.scope, e.next, e.before)),
	);
	expect(saved.paneTabs).toEqual([]);
	expect(saved.rightPaneLayout?.tabs.map((t) => t.tabId)).toEqual([
		"right-tab",
		"center-tab",
	]);
	expect(saved.activePaneArea).toBe("right");
	expect(saved.activePaneId).toBe("terminal");
	expect(
		saved.panes.map((p) => [p.resourceId, p.executionId, p.pinned]),
	).toEqual([
		["pty", "execution", true],
		["browser-resource", undefined, false],
	]);
	expect(e.source).toEqual(fixture());
});
test("unchanged hidden-area focus is not replaced by the compatibility projection", () => {
	const e = edit((areas) => {
		transferTabToIndex({
			source: areas.center,
			target: areas.right,
			tabId: "center-tab",
		});
	});
	const saved = workspace(
		required(applyWorkspacePaneAreas(e.source, e.scope, e.next, e.before)),
	);
	expect(saved.rightPaneOpen).toBe(false);
	expect(saved.activePaneArea).toBe("center");
	expect(saved.activePaneId).toBeNull();
	expect(saved.panes).toHaveLength(2);
});
test("an original cross-area pane split persists its original layout and each execution once", () => {
	const e = edit((areas) => {
		transferPaneToSplit({
			source: areas.center,
			target: areas.right,
			paneId: "terminal",
			targetPaneId: "browser",
			position: "bottom",
		});
		areas.activate("right");
	});
	const saved = workspace(
		required(applyWorkspacePaneAreas(e.source, e.scope, e.next, e.before)),
	);
	expect(saved.paneTabs).toEqual([]);
	expect(saved.rightPaneLayout?.tabs[0]?.layout).toMatchObject({
		type: "split",
		axis: "vertical",
	});
	expect(saved.panes.map((p) => [p.resourceId, p.executionId])).toEqual([
		["pty", "execution"],
		["browser-resource", undefined],
	]);
});
test("disjoint area title changes merge without reverting either side", () => {
	const e = edit((areas) => {
		areas.center.getState().setTabTitleOverride({
			tabId: "center-tab",
			titleOverride: "Center edit",
		});
	});
	const current = structuredClone(e.source);
	required(workspace(current).rightPaneLayout?.tabs[0]).label =
		"Concurrent right edit";
	const saved = workspace(
		required(applyWorkspacePaneAreas(current, e.scope, e.next, e.before)),
	);
	expect(saved.paneTabs?.[0]?.label).toBe("Center edit");
	expect(saved.rightPaneLayout?.tabs[0]?.label).toBe("Concurrent right edit");
});
test("independent area selections merge while only the explicit active-area intent gains focus", () => {
	const view = multiTabFixture();
	const centerEdit = edit((areas) => {
		areas.center.getState().setActiveTab("chat-tab");
	}, view);
	const current = required(
		applyWorkspacePaneAreas(
			view,
			centerEdit.scope,
			centerEdit.next,
			centerEdit.before,
		),
	);
	const rightEdit = edit((areas) => {
		areas.right.getState().setActiveTab("right-terminal-tab");
		areas.activate("right");
	}, view);
	const saved = workspace(
		required(
			applyWorkspacePaneAreas(
				current,
				rightEdit.scope,
				rightEdit.next,
				rightEdit.before,
			),
		),
	);
	expect(saved.activePaneTabId).toBe("chat-tab");
	expect(saved.rightPaneLayout?.activeTabId).toBe("right-terminal-tab");
	expect(saved.activePaneId).toBe("right-terminal");
	expect(saved.activeTool).toBe("chat");
});
test("area-local tab ordering survives the stable ordering used by the legacy merger", () => {
	const e = edit((areas) => {
		areas.right
			.getState()
			.reorderTab({ tabId: "right-terminal-tab", toIndex: 0 });
	}, multiTabFixture());
	const current = structuredClone(e.source);
	required(workspace(current).paneTabs?.[0]).label = "Concurrent center edit";
	const saved = workspace(
		required(applyWorkspacePaneAreas(current, e.scope, e.next, e.before)),
	);
	expect(saved.rightPaneLayout?.tabs.map((t) => t.tabId)).toEqual([
		"right-terminal-tab",
		"right-tab",
	]);
	expect(saved.rightPaneLayout?.activeTabId).toBe("right-tab");
	expect(saved.paneTabs?.[0]?.label).toBe("Concurrent center edit");
});
test("an area move rebases over a concurrent title change", () => {
	const e = edit((areas) => {
		transferTabToIndex({
			source: areas.center,
			target: areas.right,
			tabId: "center-tab",
		});
	});
	const current = structuredClone(e.source);
	required(workspace(current).paneTabs?.[0]).label = "New title";
	const saved = workspace(
		required(applyWorkspacePaneAreas(current, e.scope, e.next, e.before)),
	);
	expect(
		saved.rightPaneLayout?.tabs.find((t) => t.tabId === "center-tab")?.label,
	).toBe("New title");
	expect(saved.paneTabs).toEqual([]);
});
test("explicit false pin edits preserve a concurrent pin edit in the other area", () => {
	const e = edit((areas) => {
		areas.center
			.getState()
			.setPanePinned({ paneId: "terminal", pinned: false });
	});
	const current = structuredClone(e.source);
	required(workspace(current).panes.find((p) => p.kind === "browser")).pinned =
		true;
	const saved = workspace(
		required(applyWorkspacePaneAreas(current, e.scope, e.next, e.before)),
	);
	expect(saved.panes.map((p) => p.pinned)).toEqual([false, true]);
});
test("conflicting title edits reject without changing the supplied current view", () => {
	const e = edit((areas) => {
		areas.center.getState().setTabTitleOverride({
			tabId: "center-tab",
			titleOverride: "Late title",
		});
	});
	const current = structuredClone(e.source);
	required(workspace(current).paneTabs?.[0]).label = "Current title";
	const before = structuredClone(current);
	expect(
		applyWorkspacePaneAreas(current, e.scope, e.next, e.before),
	).toBeNull();
	expect(current).toEqual(before);
});
test("stale target identities and workspace tabs cannot rebind a pane-area edit", () => {
	const e = edit((areas) => {
		areas.setRightPaneOpen(true);
	});
	for (const patch of [
		{ backendId: "other" },
		{ namespaceId: "other" },
		{ serviceUid: 2000 },
		{ targetRevision: 2 },
		{ tabId: "other" },
	]) {
		expect(
			applyWorkspacePaneAreas(
				e.source,
				{ ...e.scope, ...patch },
				e.next,
				e.before,
			),
		).toBeNull();
	}
});
test("late metadata cannot overwrite a new execution or insert an unknown resource", () => {
	const e = edit((areas) => {
		areas.setRightPaneOpen(true);
	});
	const current = structuredClone(e.source);
	required(workspace(current).panes[0]).executionId = "new-execution";
	expect(
		applyWorkspacePaneAreas(current, e.scope, e.next, e.before),
	).toBeNull();
	const next = {
		...e.next,
		center: { ...e.next.center, tabs: structuredClone(e.next.center.tabs) },
	};
	required(next.center.tabs[0]?.panes.terminal).data.resourceId = "foreign";
	expect(applyWorkspacePaneAreas(e.source, e.scope, next, e.before)).toBeNull();
});
test("closing the right store removes only its view resources", () => {
	const e = edit((areas) => {
		areas.right.getState().removeTab("right-tab");
	});
	const saved = workspace(
		required(applyWorkspacePaneAreas(e.source, e.scope, e.next, e.before)),
	);
	expect(saved.panes.map((p) => [p.resourceId, p.executionId])).toEqual([
		["pty", "execution"],
	]);
	expect(saved.rightPaneLayout?.tabs).toEqual([]);
	expect(saved.paneTabs?.[0]?.tabId).toBe("center-tab");
});
test("layout-only changes can retain the existing debounce classification", () => {
	const view = fixture(),
		w = workspace(view),
		center = required(w.paneTabs?.[0]);
	center.layout = required(w.layout);
	w.rightPaneLayout = { version: 1, tabs: [], activeTabId: null };
	const e = edit((areas) => {
		areas.center
			.getState()
			.resizeSplit({ tabId: "center-tab", path: [], splitPercentage: 62 });
	}, view);
	expect(workspacePaneAreasMetadataKey(e.next)).toBe(
		workspacePaneAreasMetadataKey(e.before),
	);
	const saved = workspace(
		required(applyWorkspacePaneAreas(e.source, e.scope, e.next, e.before)),
	);
	expect(saved.paneTabs?.[0]?.layout).toMatchObject({
		type: "split",
		ratio: 0.62,
	});
});
test("concurrent conflicting pin choices are not silently overwritten", () => {
	const view = fixture();
	delete required(workspace(view).panes[0]).pinned;
	const e = edit((areas) => {
		areas.center.getState().setPanePinned({ paneId: "terminal", pinned: true });
	}, view);
	const current = structuredClone(e.source);
	required(workspace(current).panes[0]).pinned = false;
	expect(
		applyWorkspacePaneAreas(current, e.scope, e.next, e.before),
	).toBeNull();
});
test("focusing the right browser does not close the center Files tool", () => {
	const view = fixture();
	workspace(view).activeTool = "files";
	const e = edit((areas) => {
		areas.activate("right");
	}, view);
	const saved = workspace(
		required(applyWorkspacePaneAreas(e.source, e.scope, e.next, e.before)),
	);
	expect(saved.activeTool).toBe("files");
	expect(saved.activePaneId).toBe("browser");
});

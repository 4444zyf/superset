import { expect, test } from "bun:test";
import { createWorkspaceStore } from "@superset/panes";
import {
	fixture,
	required,
	workspace,
} from "../../../../../main/lib/ssh-direct/workspace-view-area-fixtures.test-data";
import {
	validateWorkspaceViewV3,
	type WorkspaceViewSnapshotV3,
} from "../../../../../shared/workspace-view-v3";
import type { WorkstationBrowserOpenInput } from "../../../../../shared/workstation-browser-open";
import { buildPaneTree } from "../pane-layout/pane-layout";
import { readWorkspacePaneAreas } from "../workspace-pane-areas/workspace-pane-areas";
import { openWorkstationBrowserViewV3 } from "./workspace-browser-open-view-v3";

function source() {
	const snapshot: WorkspaceViewSnapshotV3 = {
		...fixture(),
		schemaVersion: 3,
		revision: 7,
		updatedAt: 100,
	};
	const t = required(snapshot.targets[0]),
		w = workspace(snapshot);
	const { workspaces: _, activeTabId: __, ...viewIdentity } = t;
	const input: WorkstationBrowserOpenInput = {
		descriptor: {
			connectionId: t.connectionId,
			generation: 1,
			backendId: t.backendId,
			namespaceId: t.namespaceId,
			instanceId: "instance",
		},
		viewIdentity,
		workspaceId: w.workspaceId,
		workspaceName: "Owned 工作区",
		projectId: null,
		url: "http://localhost:4000/new",
		target: "current-tab",
		show: false,
	};
	return {
		snapshot,
		input,
		open: (
			changes: Partial<Parameters<typeof openWorkstationBrowserViewV3>[0]> = {},
		) =>
			openWorkstationBrowserViewV3({
				snapshot,
				input,
				paneId: "new-browser",
				resourceId: "new-page",
				tabId: "new-workspace-tab",
				...changes,
			}),
	};
}
function centerBrowser() {
	const f = source(),
		w = workspace(f.snapshot);
	w.panes.push({
		paneId: "right-browser",
		kind: "browser",
		resourceId: "right-page",
		browser: {
			url: "https://right.invalid/",
			pageTitle: "Right",
			faviconUrl: null,
		},
	});
	required(w.paneTabs?.[0]).layout = required(w.layout);
	w.rightPaneLayout = {
		version: 1,
		activeTabId: "right-tab",
		tabs: [
			{
				tabId: "right-tab",
				createdAt: 2,
				activePaneId: "right-browser",
				layout: { type: "pane", paneId: "right-browser" },
			},
		],
	};
	w.layout = buildPaneTree(w.panes.map((p) => p.paneId));
	return f;
}
test("an agent opens in the original center area while preserving the active right browser and Files tool", () => {
	const f = source(),
		w = workspace(f.snapshot);
	w.activePaneArea = "right";
	w.rightPaneOpen = true;
	w.activePaneId = "browser";
	w.activeTool = "files";
	const before = structuredClone(f.snapshot),
		opened = f.open(),
		saved = workspace(opened.view);
	expect(f.snapshot).toEqual(before);
	expect(saved.rightPaneLayout).toEqual(w.rightPaneLayout);
	expect(saved.activePaneArea).toBe("right");
	expect(saved.activePaneId).toBe("browser");
	expect(saved.activeTool).toBe("files");
	expect(saved.panes.map((p) => p.resourceId)).toEqual([
		"pty",
		"browser-resource",
		"new-page",
	]);
	expect(opened.removedPaneIds).toEqual([]);
	expect(
		opened.state.tabs.flatMap((t) => Object.values(t.panes).map((p) => p.id)),
	).toEqual(["terminal", "new-browser"]);
});
test("current-tab replacement is limited to the center and keeps right resources", () => {
	const f = centerBrowser(),
		opened = f.open(),
		saved = workspace(opened.view);
	expect(opened.removedPaneIds).toEqual(["browser"]);
	expect(saved.panes.map((p) => p.resourceId)).toEqual([
		"pty",
		"right-page",
		"new-page",
	]);
	expect(saved.rightPaneLayout?.tabs[0]?.activePaneId).toBe("right-browser");
});
test("persistent center pins are restored before the original open engine chooses a replacement", () => {
	const f = centerBrowser(),
		w = workspace(f.snapshot);
	required(w.panes.find((p) => p.paneId === "browser")).pinned = true;
	const opened = f.open();
	expect(opened.removedPaneIds).toEqual([]);
	expect(
		workspace(opened.view).panes.find((p) => p.paneId === "browser")?.pinned,
	).toBe(true);
	expect(workspace(opened.view).panes).toHaveLength(4);
});
test("a current owned runtime pin also survives the new V3 view", () => {
	const f = centerBrowser(),
		state = readWorkspacePaneAreas(workspace(f.snapshot)).center;
	const runtime = createWorkspaceStore({ initialState: state });
	runtime.getState().setPanePinned({ paneId: "browser", pinned: true });
	const opened = f.open({ runtimeState: runtime.getState() });
	expect(opened.removedPaneIds).toEqual([]);
	expect(
		workspace(opened.view).panes.find((p) => p.paneId === "browser")?.pinned,
	).toBe(true);
});
test("explicit show and new-tab select the center without closing the right area", () => {
	const f = source(),
		w = workspace(f.snapshot);
	w.activePaneArea = "right";
	w.rightPaneOpen = true;
	w.activePaneId = "browser";
	f.snapshot.activeConnectionId = null;
	const opened = f.open({
			input: { ...f.input, target: "new-tab", show: true },
		}),
		saved = workspace(opened.view);
	expect(opened.view.activeConnectionId).toBe(f.input.descriptor.connectionId);
	expect(saved.activePaneArea).toBe("center");
	expect(saved.activePaneId).toBe("new-browser");
	expect(saved.rightPaneOpen).toBe(true);
	expect(saved.paneTabs).toHaveLength(2);
	expect(saved.rightPaneLayout).toEqual(w.rightPaneLayout);
});
test("creating a previously unseen target still requires verified identity and creates no terminal", () => {
	const f = source();
	expect(() =>
		f.open({ snapshot: null, input: { ...f.input, viewIdentity: undefined } }),
	).toThrow("view identity");
	const opened = f.open({ snapshot: null }),
		saved = workspace(opened.view);
	expect(saved.panes.map((p) => p.kind)).toEqual(["browser"]);
	expect(saved.rightPaneLayout?.tabs).toEqual([]);
	expect(opened.view.activeConnectionId).toBeNull();
});
test("new center identities cannot collide with existing right panes or resources", () => {
	const f = source();
	expect(() => f.open({ paneId: "browser" })).toThrow();
	expect(() => f.open({ resourceId: "browser-resource" })).toThrow();
});
test("the final capacity includes hidden right panes", () => {
	const f = source(),
		w = workspace(f.snapshot),
		right = required(w.rightPaneLayout);
	for (let i = 0; i < 62; i++) {
		const id = `right-${i}`;
		w.panes.push({
			paneId: id,
			kind: "browser",
			resourceId: id,
			browser: { url: "about:blank", pageTitle: "", faviconUrl: null },
		});
		right.tabs.push({
			tabId: `tab-${id}`,
			createdAt: 3 + i,
			activePaneId: id,
			layout: { type: "pane", paneId: id },
		});
	}
	w.layout = buildPaneTree(w.panes.map((p) => p.paneId));
	const {
		schemaVersion: _,
		revision: __,
		updatedAt: ___,
		...view
	} = f.snapshot;
	expect(validateWorkspaceViewV3(view).targets).toHaveLength(1);
	expect(() => f.open()).toThrow();
});
test("a repeated center pane identity keeps its existing page rather than replaying navigation", () => {
	const f = source(),
		first = f.open();
	const snapshot: WorkspaceViewSnapshotV3 = {
		...first.view,
		schemaVersion: 3,
		revision: 8,
		updatedAt: 101,
	};
	const again = f.open({
		snapshot,
		input: { ...f.input, url: "http://localhost:4000/replay" },
	});
	expect(again.pane.browser.url).toBe(f.input.url);
	expect(workspace(again.view).panes).toHaveLength(3);
	expect(again.removedPaneIds).toEqual([]);
});
test("another target's complete V3 state remains untouched", () => {
	const f = source(),
		other = structuredClone(required(f.snapshot.targets[0]));
	other.connectionId = "other";
	other.backendId = "other-backend";
	f.snapshot.targets.push(other);
	f.snapshot.activeConnectionId = "other";
	const opened = f.open();
	expect(opened.view.activeConnectionId).toBe("other");
	expect(opened.view.targets[1]).toEqual(other);
});

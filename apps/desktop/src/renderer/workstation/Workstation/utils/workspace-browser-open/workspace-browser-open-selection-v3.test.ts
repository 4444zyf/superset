import { expect, test } from "bun:test";
import {
	fixture,
	required,
	workspace,
} from "../../../../../main/lib/ssh-direct/workspace-view-area-fixtures.test-data";
import {
	validateWorkspaceViewV3,
	type WorkspaceViewSnapshotV3,
} from "../../../../../shared/workspace-view-v3";
import { preserveBrowserOpenSelectionV3 } from "./workspace-browser-open-selection-v3";

function input(snapshot: WorkspaceViewSnapshotV3) {
	const { schemaVersion: _, revision: __, updatedAt: ___, ...view } = snapshot;
	return view;
}
function setup() {
	const current: WorkspaceViewSnapshotV3 = {
		...fixture(),
		schemaVersion: 3,
		revision: 1,
		updatedAt: 1,
	};
	const saved = structuredClone(current);
	saved.revision = 2;
	saved.updatedAt = 2;
	const w = workspace(saved);
	w.panes.push({
		paneId: "opened",
		resourceId: "opened-page",
		kind: "browser",
		browser: {
			url: "http://localhost:3001/",
			pageTitle: "New",
			faviconUrl: null,
		},
	});
	w.paneTabs?.push({
		tabId: "opened-tab",
		createdAt: 3,
		activePaneId: "opened",
		layout: { type: "pane", paneId: "opened" },
	});
	w.activePaneTabId = "opened-tab";
	w.activePaneId = "opened";
	w.layout = {
		type: "split",
		axis: "vertical",
		ratio: 0.5,
		first: required(w.layout),
		second: { type: "pane", paneId: "opened" },
	};
	validateWorkspaceViewV3(input(saved));
	return { current, saved };
}
const merge = (
	current: WorkspaceViewSnapshotV3 | null,
	saved: WorkspaceViewSnapshotV3,
	show = false,
	other = false,
) =>
	preserveBrowserOpenSelectionV3(
		current,
		saved,
		"local",
		"workspace",
		show,
		other,
	);
test("a late V3 browser receipt retains right focus and Files without dropping the new center resource", () => {
	const f = setup(),
		local = workspace(f.current),
		persisted = workspace(f.saved);
	local.rightPaneOpen = true;
	local.activePaneArea = "right";
	local.activePaneId = "browser";
	local.activeTool = "files";
	required(local.panes.find((p) => p.paneId === "browser")).pinned = true;
	required(persisted.panes.find((p) => p.kind === "browser")).browser = {
		url: "http://localhost:3002/",
		pageTitle: "Updated",
		faviconUrl: null,
	};
	const before = structuredClone(f);
	const result = merge(f.current, f.saved),
		w = workspace(result);
	expect(w.activePaneArea).toBe("right");
	expect(w.activePaneId).toBe("browser");
	expect(w.activeTool).toBe("files");
	expect(w.paneTabs).toHaveLength(2);
	expect(w.panes).toHaveLength(3);
	expect(w.panes.find((p) => p.paneId === "browser")?.pinned).toBe(false);
	expect(w.panes.find((p) => p.kind === "browser")?.browser?.pageTitle).toBe(
		"Updated",
	);
	expect(f).toEqual(before);
	expect(validateWorkspaceViewV3(input(result))).toEqual(input(result));
});
test("show adopts the saved center selection and a newer local revision cannot be overwritten", () => {
	const f = setup();
	const w = workspace(f.current);
	w.rightPaneOpen = true;
	w.activePaneArea = "right";
	w.activePaneId = "browser";
	expect(workspace(merge(f.current, f.saved, true)).activePaneId).toBe(
		"opened",
	);
	f.current.revision = 3;
	expect(merge(f.current, f.saved)).toBe(f.current);
});
test("hidden right resources stay hidden when the current center is empty", () => {
	const f = setup(),
		w = workspace(f.current);
	w.panes = w.panes.filter((p) => p.paneId !== "terminal");
	w.layout = { type: "pane", paneId: "browser" };
	w.paneTabs = [];
	w.activePaneTabId = null;
	w.activePaneId = null;
	const next = structuredClone(f.current);
	next.revision = 2;
	const result = workspace(merge(f.current, next));
	expect(result.rightPaneOpen).toBe(false);
	expect(result.activePaneArea).toBe("center");
	expect(result.activePaneId).toBeNull();
	expect(result.panes).toHaveLength(1);
});
test("the original selection fallback chooses a surviving center tab without recreating removed panes", () => {
	const f = setup(),
		w = workspace(f.saved);
	w.panes = w.panes.filter((p) => p.paneId !== "terminal");
	w.paneTabs = w.paneTabs?.filter((t) => t.tabId !== "center-tab");
	w.layout = {
		type: "split",
		axis: "horizontal",
		ratio: 0.5,
		first: { type: "pane", paneId: "browser" },
		second: { type: "pane", paneId: "opened" },
	};
	const result = workspace(merge(f.current, f.saved));
	expect(result.activePaneTabId).toBe("opened-tab");
	expect(result.activePaneId).toBe("opened");
	expect(result.panes.some((p) => p.paneId === "terminal")).toBe(false);
});
test("V3 receipts reject an overlapping namespace, service uid or target revision mismatch", () => {
	for (const key of ["namespaceId", "serviceUid", "targetRevision"] as const) {
		const f = setup(),
			t = required(f.current.targets[0]);
		if (key === "namespaceId") t.namespaceId = "other";
		else t[key]++;
		expect(() => merge(f.current, f.saved)).toThrow("identity changed");
	}
});
test("an absent local view adopts the saved V3 snapshot without synthesizing data", () => {
	const f = setup();
	expect(merge(null, f.saved)).toBe(f.saved);
});
test("canonical metadata in another target survives unless a later optimistic edit is pending", () => {
	const f = setup();
	const other = structuredClone(required(f.current.targets[0]));
	other.connectionId = "other";
	other.backendId = "other-backend";
	for (const w of other.workspaces) {
		w.workspaceId = "other-workspace";
		w.tabId = "other-workspace-tab";
		w.panes = w.panes.map((p) => ({
			...p,
			paneId: "other-" + p.paneId,
			resourceId: "other-" + p.resourceId,
		}));
		w.layout = {
			type: "split",
			axis: "horizontal",
			ratio: 0.5,
			first: { type: "pane", paneId: "other-terminal" },
			second: { type: "pane", paneId: "other-browser" },
		};
		w.paneTabs = [
			{
				tabId: "other-center",
				createdAt: 1,
				activePaneId: "other-terminal",
				layout: { type: "pane", paneId: "other-terminal" },
			},
		];
		w.activePaneTabId = "other-center";
		w.activePaneId = "other-terminal";
		w.rightPaneLayout = {
			version: 1,
			tabs: [
				{
					tabId: "other-right",
					createdAt: 2,
					activePaneId: "other-browser",
					layout: { type: "pane", paneId: "other-browser" },
				},
			],
			activeTabId: "other-right",
		};
	}
	other.activeTabId = "other-workspace-tab";
	f.current.targets.push(other);
	f.saved.targets.push(structuredClone(other));
	required(f.current.targets[1]?.workspaces[0]).label = "Optimistic";
	required(f.saved.targets[1]?.workspaces[0]).label = "Canonical";
	expect(merge(f.current, f.saved).targets[1]?.workspaces[0]?.label).toBe(
		"Canonical",
	);
	expect(
		merge(f.current, f.saved, false, true).targets[1]?.workspaces[0]?.label,
	).toBe("Optimistic");
});
test("a legacy single-area workspace does not acquire right-area metadata while preserving focus", () => {
	const f = setup();
	for (const snapshot of [f.current, f.saved]) {
		const w = workspace(snapshot),
			right = required(w.rightPaneLayout),
			tab = required(right.tabs[0]);
		w.paneTabs?.push(tab);
		delete w.rightPaneLayout;
		delete w.rightPaneOpen;
		delete w.activePaneArea;
	}
	const current = workspace(f.current);
	current.activePaneTabId = "right-tab";
	current.activePaneId = "browser";
	const result = workspace(merge(f.current, f.saved));
	expect(result.activePaneId).toBe("browser");
	expect(result.rightPaneLayout).toBeUndefined();
	expect(result.rightPaneOpen).toBeUndefined();
	expect(result.activePaneArea).toBeUndefined();
});

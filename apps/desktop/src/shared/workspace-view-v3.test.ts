import { expect, test } from "bun:test";
import type { PaneTree } from "./workspace-view";
import { validateWorkspaceViewV2 } from "./workspace-view-v2";
import {
	projectWorkspaceViewV2,
	validateWorkspaceViewV3,
	type WorkspaceViewInputV3,
} from "./workspace-view-v3";

function fixture(): WorkspaceViewInputV3 {
	return {
		restoreOnLaunch: true,
		activeConnectionId: "local",
		window: { x: 0, y: 0, width: 1200, height: 800, maximized: false },
		targets: [
			{
				connectionId: "local",
				targetRevision: 1,
				backendId: "backend",
				namespaceId: "namespace",
				serviceUid: 1000,
				autoConnect: true,
				activeTabId: "workspace-tab",
				workspaces: [
					{
						tabId: "workspace-tab",
						workspaceId: "workspace",
						activeTool: "terminal",
						activePaneId: "terminal",
						activePaneTabId: "center-tab",
						panes: [
							{
								paneId: "terminal",
								kind: "terminal",
								resourceId: "pty",
								executionId: "execution",
								pinned: true,
							},
							{
								paneId: "browser",
								kind: "browser",
								resourceId: "browser-resource",
								pinned: true,
								browser: {
									url: "http://localhost:3000/?q=中文#section",
									pageTitle: "页面 🙂",
									faviconUrl: null,
								},
							},
						],
						layout: {
							type: "split",
							axis: "horizontal",
							ratio: 0.37,
							first: { type: "pane", paneId: "terminal" },
							second: { type: "pane", paneId: "browser" },
						},
						paneTabs: [
							{
								tabId: "center-tab",
								createdAt: 1,
								activePaneId: "terminal",
								layout: { type: "pane", paneId: "terminal" },
							},
						],
						rightPaneLayout: {
							version: 1,
							activeTabId: "right-tab",
							tabs: [
								{
									tabId: "right-tab",
									createdAt: 2,
									activePaneId: "browser",
									layout: { type: "pane", paneId: "browser" },
								},
							],
						},
						rightPaneOpen: false,
						activePaneArea: "center",
					},
				],
			},
		],
	};
}
function required<T>(value: T | null | undefined): T {
	if (value === null || value === undefined)
		throw new Error("Missing fixture value");
	return value;
}
const workspace = (v: WorkspaceViewInputV3) =>
	required(v.targets[0]?.workspaces[0]);

test("independent areas and pinned browser and terminal data round-trip without mutating input", () => {
	const value = fixture(),
		before = structuredClone(value);
	expect(validateWorkspaceViewV3(value)).toEqual(before);
	expect(value).toEqual(before);
	const projected = projectWorkspaceViewV2(value);
	expect(validateWorkspaceViewV2(projected)).toEqual(projected);
	const w = workspace(projected);
	expect(w.paneTabs?.map((t) => t.tabId)).toEqual(["center-tab", "right-tab"]);
	expect(w.activePaneId).toBe("terminal");
	expect(w.panes.map((p) => p.resourceId)).toEqual(["pty", "browser-resource"]);
	expect(w.panes.every((p) => !("pinned" in p))).toBe(true);
	expect("rightPaneLayout" in w).toBe(false);
});

test("right focus requires an open right area and preserves the center selection", () => {
	const v = fixture(),
		w = workspace(v);
	w.rightPaneOpen = true;
	w.activePaneArea = "right";
	w.activePaneId = "browser";
	const saved = validateWorkspaceViewV3(v);
	expect(workspace(saved).activePaneTabId).toBe("center-tab");
	expect(workspace(projectWorkspaceViewV2(saved)).activePaneTabId).toBe(
		"right-tab",
	);
	w.rightPaneOpen = false;
	expect(() => validateWorkspaceViewV3(v)).toThrow();
});

test("an empty center can keep a closed populated right area without focusing a hidden pane", () => {
	const v = fixture(),
		w = workspace(v);
	required(w.rightPaneLayout).tabs.push(...required(w.paneTabs));
	w.paneTabs = [];
	w.activePaneTabId = null;
	w.activePaneId = null;
	expect(validateWorkspaceViewV3(v)).toEqual(v);
	const flat = workspace(projectWorkspaceViewV2(v));
	expect(flat.panes).toHaveLength(2);
	expect(flat.activePaneId).toBe("browser");
});

test("unextended V2 input is preserved exactly, including absent legacy tabs", () => {
	const flat = projectWorkspaceViewV2(fixture());
	delete workspace(flat).paneTabs;
	delete workspace(flat).activePaneTabId;
	expect(validateWorkspaceViewV3(flat)).toEqual(flat);
	expect(projectWorkspaceViewV2(flat)).toEqual(flat);
});

test("tab and resource identity remain unique across areas", () => {
	for (const change of [
		(w: ReturnType<typeof workspace>) => {
			required(required(w.rightPaneLayout).tabs[0]).tabId = "center-tab";
			required(w.rightPaneLayout).activeTabId = "center-tab";
		},
		(w: ReturnType<typeof workspace>) => {
			required(required(w.rightPaneLayout).tabs[0]).layout = {
				type: "pane",
				paneId: "terminal",
			};
		},
		(w: ReturnType<typeof workspace>) => {
			w.panes.push({ ...required(w.panes[0]), paneId: "duplicate" });
		},
	]) {
		const v = fixture();
		change(workspace(v));
		expect(() => validateWorkspaceViewV3(v)).toThrow();
	}
});

test("both active tab pointers and the active area's pane must remain valid", () => {
	for (const change of [
		(w: ReturnType<typeof workspace>) => {
			w.activePaneTabId = "missing";
		},
		(w: ReturnType<typeof workspace>) => {
			required(w.rightPaneLayout).activeTabId = "missing";
		},
		(w: ReturnType<typeof workspace>) => {
			w.activePaneId = "browser";
		},
		(w: ReturnType<typeof workspace>) => {
			required(required(w.rightPaneLayout).tabs[0]).activePaneId = "terminal";
		},
	]) {
		const v = fixture();
		change(workspace(v));
		expect(() => validateWorkspaceViewV3(v)).toThrow();
	}
});

test("right metadata cannot silently invent a layout or accept unknown fields", () => {
	const v = fixture(),
		w = workspace(v);
	delete w.rightPaneLayout;
	expect(() => validateWorkspaceViewV3(v)).toThrow();
	const unknown = fixture() as unknown as {
		targets: { workspaces: Record<string, unknown>[] }[];
	};
	required(unknown.targets[0]?.workspaces[0]).rightPaneExpanded = true;
	expect(() => validateWorkspaceViewV3(unknown)).toThrow();
});

test("right layout depth is checked before recursive schema parsing", () => {
	const v = fixture();
	let node: PaneTree = { type: "pane", paneId: "browser" };
	for (let i = 0; i < 32; i++)
		node = {
			type: "split",
			axis: "vertical",
			ratio: 0.5,
			first: node,
			second: { type: "pane", paneId: "browser" },
		};
	required(required(workspace(v).rightPaneLayout).tabs[0]).layout = node;
	expect(() => validateWorkspaceViewV3(v)).toThrow(
		"Workspace layout depth limit exceeded",
	);
});

test("raw size and combined area capacity retain the existing limits", () => {
	const v = fixture() as unknown as Record<string, unknown>;
	v.padding = "界".repeat(1024 * 1024);
	expect(() => validateWorkspaceViewV3(v)).toThrow(
		"Workspace view size limit exceeded",
	);
	const crowded = fixture(),
		w = workspace(crowded);
	required(w.rightPaneLayout).tabs = Array.from({ length: 64 }, (_, i) => ({
		tabId: `right-${i}`,
		createdAt: i,
		activePaneId: "browser",
		layout: { type: "pane", paneId: "browser" },
	}));
	expect(() => validateWorkspaceViewV3(crowded)).toThrow();
});

import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import {
	validateWorkspaceView,
	type WorkspaceViewInput,
} from "../../../shared/workspace-view";
import {
	projectWorkspaceViewV1,
	validateWorkspaceViewV2,
	type WorkspaceViewInputV2,
} from "../../../shared/workspace-view-v2";
import { WorkspaceViewStore } from "./workspace-view-store";

function legacyView(): WorkspaceViewInput {
	return {
		restoreOnLaunch: true,
		activeConnectionId: "mac",
		window: { x: 10, y: 20, width: 1200, height: 900, maximized: false },
		targets: [
			{
				connectionId: "mac",
				targetRevision: 1,
				backendId: "backend-a",
				namespaceId: "namespace-a",
				serviceUid: 501,
				autoConnect: true,
				activeTabId: "workspace-tab",
				workspaces: [
					{
						tabId: "workspace-tab",
						workspaceId: "workspace",
						activeTool: "terminal",
						activePaneId: "first",
						panes: [
							{
								paneId: "first",
								kind: "terminal",
								resourceId: "terminal-1",
								executionId: "execution-1",
							},
							{
								paneId: "second",
								kind: "terminal",
								resourceId: "terminal-2",
								executionId: "execution-2",
							},
						],
						layout: {
							type: "split",
							axis: "horizontal",
							ratio: 0.37,
							first: { type: "pane", paneId: "first" },
							second: { type: "pane", paneId: "second" },
						},
					},
				],
			},
		],
	};
}

function browserView(): WorkspaceViewInputV2 {
	const view: WorkspaceViewInputV2 = structuredClone(legacyView());
	const workspace = view.targets[0]?.workspaces[0];
	if (!workspace) throw new Error("Missing fixture workspace");
	workspace.panes.push({
		paneId: "browser",
		kind: "browser",
		resourceId: "browser",
		browser: {
			url: "http://localhost:3000/path?q=1#section",
			pageTitle: "页面 🙂",
			faviconUrl: null,
		},
	});
	workspace.layout = {
		type: "split",
		axis: "horizontal",
		ratio: 0.37,
		first: { type: "pane", paneId: "first" },
		second: {
			type: "split",
			axis: "vertical",
			ratio: 0.64,
			first: { type: "pane", paneId: "second" },
			second: { type: "pane", paneId: "browser" },
		},
	};
	workspace.activePaneId = "browser";
	workspace.paneTabs = [
		{
			tabId: "one",
			createdAt: 1,
			activePaneId: "first",
			layout: { type: "pane", paneId: "first" },
		},
		{
			tabId: "two",
			createdAt: 2,
			activePaneId: "browser",
			layout: workspace.layout.second,
		},
	];
	workspace.activePaneTabId = "two";
	return validateWorkspaceViewV2(view);
}

function fixture() {
	const db = new Database(":memory:");
	const store = new WorkspaceViewStore(db, () => 100);
	store.activateOwner("owner");
	return { db, store };
}

test("a browser-only workspace projects to an empty valid legacy layout", () => {
	const view = browserView();
	const workspace = view.targets[0].workspaces[0];
	workspace.panes = workspace.panes.filter((pane) => pane.kind === "browser");
	workspace.layout = { type: "pane", paneId: "browser" };
	workspace.paneTabs = [
		{
			tabId: "browser-tab",
			createdAt: 1,
			activePaneId: "browser",
			layout: workspace.layout,
		},
	];
	workspace.activePaneTabId = "browser-tab";
	const projected = projectWorkspaceViewV1(validateWorkspaceViewV2(view))
		.targets[0].workspaces[0];
	expect(projected.panes).toEqual([]);
	expect(projected.layout).toBeNull();
	expect(projected.paneTabs).toEqual([]);
	expect(projected.activePaneId).toBeNull();
	expect(projected.activePaneTabId).toBeNull();
});

test("browser and terminal panes round-trip in V2 while the V1 projection remains valid", () => {
	const { db, store } = fixture();
	try {
		const view = browserView();
		const saved = store.saveV2({ owner: "owner", expectedRevision: 0, view });
		expect(saved.schemaVersion).toBe(2);
		expect(store.readV2().snapshot?.targets).toEqual(view.targets);
		const legacy = store.read();
		if (!legacy.snapshot) throw new Error("Missing saved V1 projection");
		expect(legacy.invalid).toBe(false);
		expect(legacy.snapshot?.schemaVersion).toBe(1);
		const workspace = legacy.snapshot?.targets[0]?.workspaces[0];
		expect(workspace?.panes.map((pane) => pane.kind)).toEqual([
			"terminal",
			"terminal",
		]);
		expect(workspace?.activePaneId).toBe("second");
		expect(projectWorkspaceViewV1(view).targets).toEqual(
			legacy.snapshot.targets,
		);
		expect(() => validateWorkspaceView(view)).toThrow();
	} finally {
		db.close();
	}
});

test("legacy metadata writes preserve hidden browser state and reject an ambiguous layout change", () => {
	const { db, store } = fixture();
	try {
		store.saveV2({ owner: "owner", expectedRevision: 0, view: browserView() });
		const projected = projectWorkspaceViewV1(browserView());
		projected.window.x = 99;
		projected.targets[0].workspaces[0].label = "New workspace label";
		store.save({ owner: "owner", expectedRevision: 1, view: projected });
		expect(store.readV2().snapshot?.window.x).toBe(99);
		expect(store.readV2().snapshot?.targets[0]?.workspaces[0]?.panes).toEqual(
			browserView().targets[0]?.workspaces[0]?.panes,
		);
		expect(
			store.readV2().snapshot?.targets[0]?.workspaces[0]?.activePaneId,
		).toBe("browser");
		const before = store.readV2();
		const layout = projected.targets[0].workspaces[0].layout;
		if (!layout || layout.type !== "split")
			throw new Error("Missing fixture split");
		layout.ratio = 0.9;
		expect(() =>
			store.save({ owner: "owner", expectedRevision: 2, view: projected }),
		).toThrow("V2");
		expect(store.readV2()).toEqual(before);
	} finally {
		db.close();
	}
});

test("V2 archive switching and forget preserve namespace ownership and cleanup", () => {
	const { db, store } = fixture();
	try {
		const a = browserView();
		store.saveV2({ owner: "owner", expectedRevision: 0, view: a });
		const identity = {
			connectionId: "mac",
			targetRevision: 2,
			backendId: "backend-b",
			namespaceId: "namespace-b",
			serviceUid: 501,
		};
		store.selectLocalNamespace("owner", identity);
		const b: WorkspaceViewInputV2 = legacyView();
		Object.assign(b.targets[0], identity);
		store.saveV2({ owner: "owner", expectedRevision: 2, view: b });
		const original = a.targets[0];
		store.selectLocalNamespace("owner", original);
		expect(store.readV2().snapshot?.targets[0]?.workspaces).toEqual(
			original.workspaces,
		);
		store.forget({ owner: "owner", expectedRevision: store.read().revision });
		expect(store.readV2().snapshot).toBeNull();
		expect(
			db.prepare("SELECT COUNT(*) AS count FROM local_namespace_views").get(),
		).toEqual({ count: 0 });
	} finally {
		db.close();
	}
});

test("a legacy metadata save cannot carry browser pages into another namespace", () => {
	const { db, store } = fixture();
	try {
		store.saveV2({ owner: "owner", expectedRevision: 0, view: browserView() });
		const before = store.readV2();
		const projected = projectWorkspaceViewV1(browserView());
		projected.targets[0].namespaceId = "different-namespace";
		expect(() =>
			store.save({ owner: "owner", expectedRevision: 1, view: projected }),
		).toThrow("V2");
		expect(store.readV2()).toEqual(before);
	} finally {
		db.close();
	}
});

test("browser-free V2 saves retain the on-disk V1 format and enforce owner/revision guards", () => {
	const { db, store } = fixture();
	try {
		store.saveV2({ owner: "owner", expectedRevision: 0, view: legacyView() });
		const row = db.prepare("SELECT snapshot FROM workspace_view").get() as {
			snapshot: string;
		};
		expect(JSON.parse(row.snapshot).schemaVersion).toBe(1);
		expect(() =>
			store.saveV2({ owner: "old", expectedRevision: 1, view: browserView() }),
		).toThrow("owner");
		expect(() =>
			store.saveV2({
				owner: "owner",
				expectedRevision: 0,
				view: browserView(),
			}),
		).toThrow("revision");
		expect(store.read().snapshot?.targets).toEqual(legacyView().targets);
	} finally {
		db.close();
	}
});

test("new browser validation keeps old layout bounds and excludes executable/file URLs", () => {
	const valid = browserView();
	for (const url of [
		"file:///etc/passwd",
		"javascript:alert(1)",
		"chrome://version",
	]) {
		const value = structuredClone(valid);
		const pane = value.targets[0]?.workspaces[0]?.panes.find(
			(pane) => pane.kind === "browser",
		);
		if (!pane || pane.kind !== "browser")
			throw new Error("Missing browser fixture");
		pane.browser.url = url;
		expect(() => validateWorkspaceViewV2(value)).toThrow();
	}
	const bad = structuredClone(valid);
	bad.targets[0].workspaces[0].activePaneId = "missing";
	expect(() => validateWorkspaceViewV2(bad)).toThrow();
});

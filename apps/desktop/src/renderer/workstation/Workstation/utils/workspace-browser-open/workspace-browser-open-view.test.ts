import { validateWorkspaceViewV2 } from "shared/workspace-view-v2";
import { expect, test } from "bun:test";
import { createWorkspaceStore } from "@superset/panes";
import type { WorkstationBrowserOpenInput } from "shared/workstation-browser-open";
import { emptyWorkspaceView } from "shared/workspace-view";
import type {
	WorkspaceViewSnapshotV2,
	WorkspacePaneV2,
} from "shared/workspace-view-v2";
import { toPaneState } from "../pane-adapter/pane-adapter";
import { openWorkstationBrowserView } from "./workspace-browser-open-view";
function fixture() {
	const a = crypto.randomUUID(),
		b = crypto.randomUUID(),
		workspaceId = crypto.randomUUID();
	const target = (connectionId: string) => ({
		connectionId,
		targetRevision: 1,
		backendId: "backend-" + connectionId,
		namespaceId: "namespace",
		serviceUid: 1000,
		autoConnect: true,
		activeTabId: "workspace-tab",
		workspaces: [
			{
				workspaceId,
				tabId: "workspace-tab",
				activeTool: "terminal" as const,
				activePaneId: "terminal",
				panes: [
					{
						paneId: "terminal",
						kind: "terminal" as const,
						resourceId: "pty",
						executionId: "execution",
					},
				],
				layout: { type: "pane" as const, paneId: "terminal" },
			},
		],
	});
	const snapshot: WorkspaceViewSnapshotV2 = {
		...emptyWorkspaceView({
			x: 1,
			y: 2,
			width: 1200,
			height: 850,
			maximized: false,
		}),
		schemaVersion: 2,
		revision: 7,
		updatedAt: 1,
		activeConnectionId: a,
		targets: [target(a), target(b)],
	};
	const input: WorkstationBrowserOpenInput = {
		descriptor: {
			connectionId: b,
			generation: 1,
			backendId: "backend-" + b,
			namespaceId: "namespace",
			instanceId: "instance",
		},
		workspaceId,
		projectId: null,
		workspaceName: "Owned 工作区",
		url: "http://localhost:3000/中文",
		target: "current-tab",
		show: false,
	};
	const open = (
		changes: Partial<Parameters<typeof openWorkstationBrowserView>[0]> = {},
	) =>
		openWorkstationBrowserView({
			snapshot,
			input,
			paneId: "new-browser",
			resourceId: "new-page",
			tabId: "new-workspace-tab",
			...changes,
		});
	return { a, b, snapshot, input, open };
}
test("opening in background B preserves A selection, B selection, and both original terminal resources", () => {
	const f = fixture(),
		before = structuredClone(f.snapshot),
		next = f.open();
	expect(f.snapshot).toEqual(before);
	expect(next.view.activeConnectionId).toBe(f.a);
	expect(next.view.targets[0]).toEqual(before.targets[0]);
	const b = next.view.targets[1]!;
	expect(b.activeTabId).toBe("workspace-tab");
	expect(b.workspaces[0]?.activePaneId).toBe("terminal");
	expect(
		b.workspaces[0]?.panes.map((p) => [p.kind, p.resourceId, p.executionId]),
	).toEqual([
		["terminal", "pty", "execution"],
		["browser", "new-page", undefined],
	]);
});
test("show and new-tab are explicit independent intents", () => {
	const f = fixture(),
		next = f.open({ input: { ...f.input, show: true, target: "new-tab" } }),
		b = next.view.targets[1]!;
	expect(next.view.activeConnectionId).toBe(f.b);
	expect(b.workspaces[0]?.activePaneId).toBe("new-browser");
	expect(b.workspaces[0]?.paneTabs).toHaveLength(2);
});
test("a workspace absent from the view is opened as browser-only without a terminal resource", () => {
	const f = fixture(),
		next = f.open({ input: { ...f.input, workspaceId: crypto.randomUUID() } });
	const workspace = next.view.targets[1]?.workspaces[1];
	expect(workspace?.label).toBe("Owned 工作区");
	expect(workspace?.panes.map((p) => p.kind)).toEqual(["browser"]);
	expect(next.view.targets[1]?.activeTabId).toBe("workspace-tab");
});
test("a previously unseen target requires verified Main identity rather than synthesizing a uid", () => {
	const f = fixture(),
		snapshot = { ...f.snapshot, targets: [f.snapshot.targets[0]!] };
	expect(() => f.open({ snapshot })).toThrow("view identity");
	const source = f.snapshot.targets[1]!,
		{ workspaces: _, activeTabId: __, ...viewIdentity } = source;
	const next = f.open({ snapshot, input: { ...f.input, viewIdentity } });
	expect(next.view.targets[1]?.serviceUid).toBe(1000);
	expect(next.view.activeConnectionId).toBe(f.a);
	expect(next.view.targets[1]?.activeTabId).toBeNull();
	expect(() =>
		f.open({
			snapshot,
			input: { ...f.input, viewIdentity: { ...viewIdentity, serviceUid: 0 } },
		}),
	).toThrow();
});
test("actual pinned runtime state retains the existing browser while an unpinned browser is replaced", () => {
	const f = fixture(),
		workspace = f.snapshot.targets[1]!.workspaces[0]!;
	workspace.panes.push({
		kind: "browser",
		paneId: "old-browser",
		resourceId: "old-page",
		browser: { url: "https://old.invalid/", pageTitle: "", faviconUrl: null },
	});
	workspace.layout = {
		type: "split",
		axis: "horizontal",
		ratio: 0.5,
		first: { type: "pane", paneId: "terminal" },
		second: { type: "pane", paneId: "old-browser" },
	};
	const unpinned = f.open();
	expect(unpinned.removedPaneIds).toEqual(["old-browser"]);
	const store = createWorkspaceStore<WorkspacePaneV2>({
		initialState: toPaneState(workspace),
	});
	store.getState().setPanePinned({
		paneId: "old-browser",
		pinned: true,
	});
	const pinned = f.open({ runtimeState: store.getState() });
	expect(pinned.removedPaneIds).toEqual([]);
	expect(
		pinned.view.targets[1]?.workspaces[0]?.panes.map((p) => p.paneId),
	).toEqual(["terminal", "old-browser", "new-browser"]);
});
test("view target collisions and workspace capacity fail before modifying the input", () => {
	const f = fixture(),
		before = structuredClone(f.snapshot);
	expect(() =>
		f.open({
			input: {
				...f.input,
				descriptor: { ...f.input.descriptor, namespaceId: "other" },
			},
		}),
	).toThrow("identity changed");
	expect(f.snapshot).toEqual(before);
	f.snapshot.targets[1]!.workspaces = Array.from({ length: 19 }, (_, i) => ({
		workspaceId: "workspace-" + i,
		tabId: "tab-" + i,
		activeTool: "terminal" as const,
		activePaneId: "terminal-" + i,
		panes: [
			{
				kind: "terminal" as const,
				paneId: "terminal-" + i,
				resourceId: "pty-" + i,
				executionId: "execution-" + i,
			},
		],
		layout: { type: "pane" as const, paneId: "terminal-" + i },
	}));
	f.snapshot.targets[1]!.activeTabId = "tab-0";
	const {
		schemaVersion: _,
		revision: __,
		updatedAt: ___,
		...valid
	} = f.snapshot;
	expect(validateWorkspaceViewV2(valid).targets[1]?.workspaces).toHaveLength(
		19,
	);
	expect(() => f.open()).toThrow();
	expect(f.snapshot.targets[1]?.workspaces).toHaveLength(19);
});

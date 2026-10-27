import { expect, test } from "bun:test";
import { createWorkspaceStore } from "@superset/panes";
import { emptyWorkspaceView } from "shared/workspace-view";
import type { WorkspaceViewSnapshotV2 } from "shared/workspace-view-v2";
import { toPaneState } from "../pane-adapter/pane-adapter";
import { applyWorkspacePaneState } from "../workspace-pane-state/workspace-pane-state";
import { openWorkstationBrowserView } from "./workspace-browser-open-view";
import { preserveBrowserOpenSelection } from "./workspace-browser-open-selection";
function fixture() {
	const a = crypto.randomUUID(),
		b = crypto.randomUUID(),
		workspaceId = crypto.randomUUID();
	const target = (connectionId: string) => ({
		connectionId,
		targetRevision: 1,
		backendId: connectionId,
		namespaceId: "namespace",
		serviceUid: 1000,
		autoConnect: true,
		activeTabId: "workspace-tab",
		workspaces: [
			{
				tabId: "workspace-tab",
				workspaceId,
				activeTool: "terminal" as const,
				activePaneId: "terminal",
				panes: [
					{
						kind: "terminal" as const,
						paneId: "terminal",
						resourceId: "pty",
						executionId: "execution",
					},
					{
						kind: "browser" as const,
						paneId: "browser",
						resourceId: "page",
						browser: {
							url: "https://old.invalid/",
							pageTitle: "",
							faviconUrl: null,
						},
					},
				],
				layout: {
					type: "split" as const,
					axis: "horizontal" as const,
					ratio: 0.5,
					first: { type: "pane" as const, paneId: "terminal" },
					second: { type: "pane" as const, paneId: "browser" },
				},
			},
		],
	});
	const current: WorkspaceViewSnapshotV2 = {
		...emptyWorkspaceView({
			x: 0,
			y: 0,
			width: 1200,
			height: 850,
			maximized: false,
		}),
		schemaVersion: 2,
		revision: 1,
		updatedAt: 1,
		activeConnectionId: a,
		targets: [target(a), target(b)],
	};
	const opened = openWorkstationBrowserView({
		snapshot: current,
		input: {
			descriptor: {
				connectionId: b,
				generation: 1,
				backendId: b,
				namespaceId: "namespace",
				instanceId: "instance",
			},
			workspaceId,
			workspaceName: "Owned",
			projectId: null,
			url: "https://next.invalid/",
			target: "new-tab",
			show: false,
		},
		paneId: "next",
		resourceId: "next-page",
		tabId: "unused",
	});
	const saved = {
		...opened.view,
		schemaVersion: 2 as const,
		revision: 2,
		updatedAt: 2,
	};
	return { a, b, workspaceId, current, saved };
}
test("a late background snapshot preserves the latest connection and pane selection", () => {
	const f = fixture(),
		workspace = f.current.targets[1]!.workspaces[0]!,
		store = createWorkspaceStore({ initialState: toPaneState(workspace) }),
		before = store.getState();
	store.getState().setActivePane({ tabId: "workspace-tab", paneId: "browser" });
	expect(applyWorkspacePaneState(workspace, store.getState(), before)).toBe(
		true,
	);
	f.current.activeConnectionId = f.b;
	const merged = preserveBrowserOpenSelection(
		f.current,
		f.saved,
		f.b,
		f.workspaceId,
		false,
	);
	expect(merged.activeConnectionId).toBe(f.b);
	expect(merged.targets[1]?.workspaces[0]?.activePaneId).toBe("browser");
	expect(
		merged.targets[1]?.workspaces[0]?.panes.some((p) => p.paneId === "next"),
	).toBe(true);
});
test("canonical updates from the save are retained unless a later optimistic edit is pending", () => {
	const f = fixture();
	f.current.targets[0]!.workspaces[0]!.label = "optimistic";
	f.saved.targets[0]!.workspaces[0]!.label = "canonical";
	expect(
		preserveBrowserOpenSelection(f.current, f.saved, f.b, f.workspaceId, false)
			.targets[0]?.workspaces[0]?.label,
	).toBe("canonical");
	expect(
		preserveBrowserOpenSelection(
			f.current,
			f.saved,
			f.b,
			f.workspaceId,
			false,
			true,
		).targets[0]?.workspaces[0]?.label,
	).toBe("optimistic");
});
test("show adopts the requested selection while a newer persisted view is never replaced", () => {
	const f = fixture();
	f.saved.activeConnectionId = f.b;
	const selected = preserveBrowserOpenSelection(
		f.current,
		f.saved,
		f.b,
		f.workspaceId,
		true,
	);
	expect(selected.activeConnectionId).toBe(f.b);
	f.current.revision = 3;
	expect(
		preserveBrowserOpenSelection(f.current, f.saved, f.b, f.workspaceId, false),
	).toBe(f.current);
});
test("a snapshot from a previous namespace cannot overwrite the current view identity", () => {
	const f = fixture();
	f.current.targets[0]!.namespaceId = "new-namespace";
	expect(() =>
		preserveBrowserOpenSelection(f.current, f.saved, f.b, f.workspaceId, false),
	).toThrow("identity changed");
});

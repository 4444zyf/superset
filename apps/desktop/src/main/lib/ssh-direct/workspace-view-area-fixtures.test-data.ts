import {
	validateWorkspaceViewV3,
	type WorkspaceViewInputV3,
} from "../../../shared/workspace-view-v3";

export function required<T>(value: T | null | undefined): T {
	if (value === null || value === undefined)
		throw Error("Missing fixture value");
	return value;
}
export const workspace = (v: WorkspaceViewInputV3) =>
	required(v.targets[0]?.workspaces[0]);
export function fixture(): WorkspaceViewInputV3 {
	return validateWorkspaceViewV3({
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
								pinned: false,
								browser: {
									url: "http://localhost:3000/",
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
	});
}

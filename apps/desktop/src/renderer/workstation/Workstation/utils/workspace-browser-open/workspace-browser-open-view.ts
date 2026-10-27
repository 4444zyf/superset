import type { WorkspaceState } from "@superset/panes";
import type { WorkstationBrowserOpenInput } from "shared/workstation-browser-open";
import { emptyWorkspaceView } from "shared/workspace-view";
import {
	validateWorkspaceViewV2,
	type WorkspaceViewSnapshotV2,
	type WorkspaceViewInputV2,
	type WorkspacePaneV2,
} from "shared/workspace-view-v2";
import { toPaneState } from "../pane-adapter/pane-adapter";
import { applyWorkspacePaneState } from "../workspace-pane-state/workspace-pane-state";
import { openWorkstationBrowserState } from "./workspace-browser-open";
export function openWorkstationBrowserView({
	snapshot,
	input,
	paneId,
	resourceId,
	tabId,
	runtimeState,
}: {
	snapshot: WorkspaceViewSnapshotV2 | null;
	input: WorkstationBrowserOpenInput;
	paneId: string;
	resourceId: string;
	tabId: string;
	runtimeState?: WorkspaceState<WorkspacePaneV2>;
}) {
	let view: WorkspaceViewInputV2;
	if (snapshot) {
		const {
			schemaVersion: _,
			revision: __,
			updatedAt: ___,
			...data
		} = structuredClone(snapshot);
		view = data;
	} else
		view = emptyWorkspaceView({
			x: 0,
			y: 0,
			width: 1280,
			height: 850,
			maximized: false,
		});
	const descriptor = input.descriptor;
	let target = view.targets.find(
		(item) => item.connectionId === descriptor.connectionId,
	);
	if (!target) {
		const identity = input.viewIdentity;
		if (
			!identity ||
			identity.connectionId !== descriptor.connectionId ||
			identity.backendId !== descriptor.backendId ||
			identity.namespaceId !== descriptor.namespaceId
		)
			throw Error("Browser open view identity is unavailable");
		target = { ...identity, activeTabId: null, workspaces: [] };
		view.targets.push(target);
	}
	if (
		target.backendId !== descriptor.backendId ||
		target.namespaceId !== descriptor.namespaceId
	)
		throw Error("Browser open target identity changed");
	let workspace = target.workspaces.find(
		(item) => item.workspaceId === input.workspaceId,
	);
	if (!workspace) {
		workspace = {
			workspaceId: input.workspaceId,
			tabId,
			label: input.workspaceName.slice(0, 128),
			activeTool: "terminal",
			activePaneId: null,
			panes: [],
			layout: null,
			paneTabs: [],
			activePaneTabId: null,
		};
		target.workspaces.push(workspace);
	}
	const pane: Extract<WorkspacePaneV2, { kind: "browser" }> = {
		kind: "browser",
		paneId,
		resourceId,
		browser: { url: input.url, pageTitle: "", faviconUrl: null },
	};
	const previous = runtimeState ?? toPaneState(workspace);
	const opened = openWorkstationBrowserState({
		previous,
		pane,
		target: input.target,
		show: input.show,
	});
	const existing = workspace.panes.find((item) => item.paneId === paneId);
	if (
		existing &&
		(existing.kind !== "browser" || existing.resourceId !== resourceId)
	)
		throw Error("Browser pane identity changed");
	if (!existing) workspace.panes.push(pane);
	if (!applyWorkspacePaneState(workspace, opened.state, toPaneState(workspace)))
		throw Error("Browser open layout changed");
	if (input.show) {
		view.activeConnectionId = descriptor.connectionId;
		target.activeTabId = workspace.tabId;
	}
	return {
		view: validateWorkspaceViewV2(view),
		state: opened.state,
		pane: existing ?? pane,
		workspaceTabId: workspace.tabId,
		removedPaneIds: opened.removedPaneIds,
	};
}

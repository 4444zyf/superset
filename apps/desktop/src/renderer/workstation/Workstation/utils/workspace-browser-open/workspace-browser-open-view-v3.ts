import { emptyWorkspaceView } from "../../../../../shared/workspace-view";
import type { WorkspaceViewSnapshotV2 } from "../../../../../shared/workspace-view-v2";
import {
	projectWorkspaceViewV2,
	validateWorkspaceViewV3,
	type WorkspaceViewSnapshotV3,
} from "../../../../../shared/workspace-view-v3";
import { fromPaneLayout } from "../pane-adapter/pane-adapter";
import { buildPaneTree } from "../pane-layout/pane-layout";
import { readWorkspacePaneAreas } from "../workspace-pane-areas/workspace-pane-areas";
import { openWorkstationBrowserView } from "./workspace-browser-open-view";

type Input = Omit<
	Parameters<typeof openWorkstationBrowserView>[0],
	"snapshot"
> & { snapshot: WorkspaceViewSnapshotV3 | null };

export function projectBrowserOpenSnapshotV2(
	snapshot: WorkspaceViewSnapshotV3,
): WorkspaceViewSnapshotV2 {
	const { schemaVersion: _, revision, updatedAt, ...view } = snapshot;
	return {
		...projectWorkspaceViewV2(view),
		schemaVersion: 2,
		revision,
		updatedAt,
	};
}

export function openWorkstationBrowserViewV3({ snapshot, ...args }: Input) {
	const input = snapshot
		? (({ schemaVersion: _, revision: __, updatedAt: ___, ...view }) => view)(
				snapshot,
			)
		: emptyWorkspaceView({
				x: 0,
				y: 0,
				width: 1280,
				height: 850,
				maximized: false,
			});
	const view = validateWorkspaceViewV3(input);
	const originalTarget = view.targets.find(
		(t) => t.connectionId === args.input.descriptor.connectionId,
	);
	const original = originalTarget?.workspaces.find(
		(w) => w.workspaceId === args.input.workspaceId,
	);
	const areas = original ? readWorkspacePaneAreas(original) : undefined;
	const centerView = projectWorkspaceViewV2(view);
	const center = centerView.targets
		.find((t) => t.connectionId === args.input.descriptor.connectionId)
		?.workspaces.find((w) => w.workspaceId === args.input.workspaceId);
	if (center && areas) {
		const ids = new Set(
			areas.center.tabs.flatMap((tab) => Object.keys(tab.panes)),
		);
		center.panes = center.panes.filter((pane) => ids.has(pane.paneId));
		center.paneTabs = areas.center.tabs.map((tab) => ({
			tabId: tab.id,
			label: tab.titleOverride,
			createdAt: tab.createdAt,
			activePaneId: tab.activePaneId,
			layout: fromPaneLayout(tab.layout),
		}));
		center.activePaneTabId = areas.center.activeTabId;
		center.activePaneId =
			center.paneTabs.find((tab) => tab.tabId === center.activePaneTabId)
				?.activePaneId ?? null;
		center.layout = buildPaneTree(center.panes.map((pane) => pane.paneId));
	}
	const opened = openWorkstationBrowserView({
		...args,
		snapshot: snapshot
			? {
					...centerView,
					schemaVersion: 2,
					revision: snapshot.revision,
					updatedAt: snapshot.updatedAt,
				}
			: null,
		runtimeState: args.runtimeState ?? areas?.center,
	});
	const openedTarget = opened.view.targets.find(
		(t) => t.connectionId === args.input.descriptor.connectionId,
	);
	const openedWorkspace = openedTarget?.workspaces.find(
		(w) => w.workspaceId === args.input.workspaceId,
	);
	if (!openedTarget || !openedWorkspace?.paneTabs)
		throw new Error("Browser open center layout is unavailable");
	const right = original?.rightPaneLayout ?? {
		version: 1 as const,
		tabs: [],
		activeTabId: null,
	};
	const rightIds = new Set(
		areas?.right.tabs.flatMap((tab) => Object.keys(tab.panes)) ?? [],
	);
	const runtimePanes = new Map(
		opened.state.tabs.flatMap((tab) =>
			Object.values(tab.panes).map((pane) => [pane.id, pane] as const),
		),
	);
	const panes = openedWorkspace.panes.map((pane) => {
		const runtime = runtimePanes.get(pane.paneId);
		const before = original?.panes.find(
			(p) =>
				p.paneId === pane.paneId &&
				p.kind === pane.kind &&
				p.resourceId === pane.resourceId &&
				p.executionId === pane.executionId,
		);
		const sameRuntime =
			runtime?.kind === pane.kind &&
			runtime.data.resourceId === pane.resourceId &&
			runtime.data.executionId === pane.executionId;
		const pinned =
			sameRuntime && runtime.pinned !== undefined
				? runtime.pinned
				: before?.pinned;
		return { ...pane, ...(pinned === undefined ? {} : { pinned }) };
	});
	panes.push(
		...(original?.panes.filter((pane) => rightIds.has(pane.paneId)) ?? []),
	);
	const order = new Map(
		original?.panes.map((pane, index) => [pane.paneId, index]) ?? [],
	);
	panes.sort(
		(a, b) =>
			(order.get(a.paneId) ?? order.size) - (order.get(b.paneId) ?? order.size),
	);
	const active = args.input.show
		? "center"
		: (original?.activePaneArea ?? "center");
	const focused =
		active === "right"
			? right.tabs.find((tab) => tab.tabId === right.activeTabId)
			: openedWorkspace.paneTabs.find(
					(tab) => tab.tabId === openedWorkspace.activePaneTabId,
				);
	const workspace = {
		...openedWorkspace,
		panes,
		layout: buildPaneTree(panes.map((pane) => pane.paneId)),
		rightPaneLayout: right,
		rightPaneOpen: original?.rightPaneOpen ?? false,
		activePaneArea: active,
		activePaneId: focused?.activePaneId ?? null,
		activeTool: args.input.show
			? ("terminal" as const)
			: (original?.activeTool ?? openedWorkspace.activeTool),
	};
	const { workspaces: _, ...identity } = openedTarget;
	let target = view.targets.find(
		(t) => t.connectionId === openedTarget.connectionId,
	);
	if (!target) {
		target = { ...identity, workspaces: [] };
		view.targets.push(target);
	}
	Object.assign(target, identity);
	const index = target.workspaces.findIndex(
		(w) => w.workspaceId === workspace.workspaceId,
	);
	if (index < 0) target.workspaces.push(workspace);
	else target.workspaces[index] = workspace;
	view.activeConnectionId = opened.view.activeConnectionId;
	const saved = validateWorkspaceViewV3(view);
	const pane = saved.targets
		.find((t) => t.connectionId === openedTarget.connectionId)
		?.workspaces.find((w) => w.workspaceId === args.input.workspaceId)
		?.panes.find((p) => p.paneId === opened.pane.paneId);
	if (pane?.kind !== "browser")
		throw new Error("Browser pane identity changed");
	return { ...opened, view: saved, pane };
}

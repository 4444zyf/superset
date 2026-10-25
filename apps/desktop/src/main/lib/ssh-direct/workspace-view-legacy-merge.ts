import { isDeepStrictEqual } from "node:util";
import type { WorkspaceViewInput } from "../../../shared/workspace-view";
import {
	projectWorkspaceViewV1,
	validateWorkspaceViewV2,
	type WorkspaceViewInputV2,
} from "../../../shared/workspace-view-v2";

export function mergeLegacyWorkspaceView(
	previous: WorkspaceViewInputV2,
	next: WorkspaceViewInput,
): WorkspaceViewInputV2 {
	const projection = projectWorkspaceViewV1(previous);
	return validateWorkspaceViewV2({
		...next,
		targets: next.targets.map((target) => ({
			...target,
			workspaces: target.workspaces.map((workspace) => {
				const original = previous.targets
					.find((item) => item.connectionId === target.connectionId)
					?.workspaces.find(
						(item) => item.workspaceId === workspace.workspaceId,
					);
				if (!original?.panes.some((pane) => pane.kind === "browser"))
					return workspace;
				const oldTarget = previous.targets.find(
					(item) => item.connectionId === target.connectionId,
				);
				if (
					oldTarget?.backendId !== target.backendId ||
					oldTarget.namespaceId !== target.namespaceId ||
					oldTarget.serviceUid !== target.serviceUid
				)
					throw new Error("Workspace identity requires V2");
				const projected = projection.targets
					.find((item) => item.connectionId === target.connectionId)
					?.workspaces.find(
						(item) => item.workspaceId === workspace.workspaceId,
					);
				if (!projected) throw new Error("Workspace layout requires V2");
				const tabStructure = (value: typeof projected) =>
					value.paneTabs?.map((tab) => ({
						tabId: tab.tabId,
						createdAt: tab.createdAt,
						layout: tab.layout,
					}));
				if (
					!isDeepStrictEqual(projected.layout, workspace.layout) ||
					!isDeepStrictEqual(
						tabStructure(projected),
						tabStructure(workspace),
					) ||
					!isDeepStrictEqual(
						projected.panes.map((pane) => [pane.paneId, pane.kind]),
						workspace.panes.map((pane) => [pane.paneId, pane.kind]),
					)
				)
					throw new Error("Workspace layout requires V2");
				const focusChanged =
					workspace.activePaneId !== projected.activePaneId ||
					workspace.activePaneTabId !== projected.activePaneTabId;
				return {
					...workspace,
					panes: original.panes.map((pane) =>
						pane.kind === "browser"
							? pane
							: workspace.panes.find((item) => item.paneId === pane.paneId),
					),
					layout: original.layout,
					activePaneId: focusChanged
						? workspace.activePaneId
						: original.activePaneId,
					...(original.paneTabs
						? {
								paneTabs: original.paneTabs.map((tab) => {
									const incoming = workspace.paneTabs?.find(
										(item) => item.tabId === tab.tabId,
									);
									const before = projected.paneTabs?.find(
										(item) => item.tabId === tab.tabId,
									);
									if (!incoming || !before) return tab;
									return {
										...tab,
										label: incoming.label,
										activePaneId:
											incoming.activePaneId !== before.activePaneId ||
											(focusChanged && tab.tabId === workspace.activePaneTabId)
												? incoming.activePaneId
												: tab.activePaneId,
									};
								}),
								activePaneTabId: focusChanged
									? workspace.activePaneTabId
									: original.activePaneTabId,
							}
						: {}),
				};
			}),
		})),
	});
}

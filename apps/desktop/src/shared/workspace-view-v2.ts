import { z } from "zod";
import {
	type PaneTree,
	validateWorkspaceView,
	validateWorkspaceViewWithSchema,
	type WorkspaceViewInput,
	workspaceViewInputSchema,
} from "./workspace-view";

const targetV1 = workspaceViewInputSchema.shape.targets.element;
const workspaceV1 = targetV1.shape.workspaces.element;
const paneV1 = workspaceV1.shape.panes.element;

export const browserPageStateSchema = z.strictObject({
	url: z
		.string()
		.max(8192)
		.refine((value) => {
			try {
				return ["http:", "https:", "about:"].includes(new URL(value).protocol);
			} catch {
				return false;
			}
		}),
	pageTitle: z.string().max(4096),
	faviconUrl: z.string().max(16384).nullable(),
});
export type BrowserPageState = z.infer<typeof browserPageStateSchema>;

const browserPane = z.strictObject({
	paneId: paneV1.shape.paneId,
	kind: z.literal("browser"),
	resourceId: paneV1.shape.resourceId,
	executionId: z.undefined().optional(),
	label: paneV1.shape.label,
	browser: browserPageStateSchema,
});
const workspaceV2 = workspaceV1.extend({
	panes: z.array(z.union([paneV1, browserPane])).max(64),
});
const targetV2 = targetV1.extend({
	workspaces: z.array(workspaceV2).max(20),
});
export const workspaceViewInputV2Schema = workspaceViewInputSchema.extend({
	targets: z.array(targetV2).max(10),
});

export type WorkspaceViewInputV2 = z.infer<typeof workspaceViewInputV2Schema>;
export type TargetViewV2 = WorkspaceViewInputV2["targets"][number];
export type WorkspaceViewV2 = TargetViewV2["workspaces"][number];
export type WorkspacePaneV2 = WorkspaceViewV2["panes"][number];
export interface WorkspaceViewSnapshotV2 extends WorkspaceViewInputV2 {
	schemaVersion: 2;
	revision: number;
	updatedAt: number;
}

export interface WorkspaceViewV2Save {
	expectedRevision: number;
	navigationRevision: number;
	view: WorkspaceViewInputV2;
	browserLeases?: { connectionId: string; generation: number }[];
}

export function validateWorkspaceViewV2(value: unknown): WorkspaceViewInputV2 {
	return validateWorkspaceViewWithSchema(value, workspaceViewInputV2Schema);
}

function pruneLayout(
	layout: PaneTree | null,
	visible: Set<string>,
): PaneTree | null {
	if (!layout) return null;
	if (layout.type === "pane") return visible.has(layout.paneId) ? layout : null;
	const first = pruneLayout(layout.first, visible);
	const second = pruneLayout(layout.second, visible);
	return first && second ? { ...layout, first, second } : (first ?? second);
}

function firstPaneId(layout: PaneTree): string {
	return layout.type === "pane" ? layout.paneId : firstPaneId(layout.first);
}

export function projectWorkspaceViewV1(
	view: WorkspaceViewInputV2,
): WorkspaceViewInput {
	return validateWorkspaceView({
		...view,
		targets: view.targets.map((target) => ({
			...target,
			workspaces: target.workspaces.map((workspace) => {
				const panes = workspace.panes.filter((pane) => pane.kind !== "browser");
				const visible = new Set(panes.map((pane) => pane.paneId));
				let activePaneId: string | null =
					workspace.activePaneId && visible.has(workspace.activePaneId)
						? workspace.activePaneId
						: (panes[0]?.paneId ?? null);
				const paneTabs = workspace.paneTabs?.flatMap((tab) => {
					const layout = pruneLayout(tab.layout, visible);
					if (!layout) return [];
					return [
						{
							...tab,
							layout,
							activePaneId:
								tab.activePaneId && visible.has(tab.activePaneId)
									? tab.activePaneId
									: firstPaneId(layout),
						},
					];
				});
				const active =
					paneTabs?.find((tab) => tab.tabId === workspace.activePaneTabId) ??
					paneTabs?.[0];
				if (paneTabs) activePaneId = active?.activePaneId ?? null;
				return {
					...workspace,
					panes,
					activePaneId,
					layout: pruneLayout(workspace.layout, visible),
					...(paneTabs
						? { paneTabs, activePaneTabId: active?.tabId ?? null }
						: {}),
				};
			}),
		})),
	});
}

export function hasBrowserPanes(view: WorkspaceViewInputV2): boolean {
	return view.targets.some((target) =>
		target.workspaces.some((workspace) =>
			workspace.panes.some((pane) => pane.kind === "browser"),
		),
	);
}

import { z } from "zod";
import {
	validateWorkspaceViewV2,
	type WorkspaceViewInputV2,
	workspaceViewInputV2Schema,
} from "./workspace-view-v2";

const targetV2 = workspaceViewInputV2Schema.shape.targets.element;
const workspaceV2 = targetV2.shape.workspaces.element;
const panesV2 = workspaceV2.shape.panes.element.options;
const pinned = { pinned: z.boolean().optional() };
const workspaceV3 = workspaceV2.extend({
	panes: z
		.array(
			z.union([panesV2[0].safeExtend(pinned), panesV2[1].safeExtend(pinned)]),
		)
		.max(64),
	rightPaneLayout: z
		.strictObject({
			version: z.literal(1),
			tabs: workspaceV2.shape.paneTabs.unwrap(),
			activeTabId: workspaceV2.shape.activePaneTabId.unwrap(),
		})
		.optional(),
	rightPaneOpen: z.boolean().optional(),
	activePaneArea: z.enum(["center", "right"]).optional(),
});
export const workspaceViewInputV3Schema = workspaceViewInputV2Schema.extend({
	targets: z
		.array(
			targetV2.extend({
				workspaces: z.array(workspaceV3).max(20),
			}),
		)
		.max(10),
});
export type WorkspaceViewInputV3 = z.infer<typeof workspaceViewInputV3Schema>;
export type WorkspaceViewV3 =
	WorkspaceViewInputV3["targets"][number]["workspaces"][number];
export interface WorkspaceViewSnapshotV3 extends WorkspaceViewInputV3 {
	schemaVersion: 3;
	revision: number;
	updatedAt: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}
function flattenWorkspace(value: unknown): unknown {
	if (!isRecord(value)) return value;
	const {
		rightPaneLayout,
		rightPaneOpen: _,
		activePaneArea,
		...workspace
	} = value;
	if (Array.isArray(workspace.panes)) {
		workspace.panes = workspace.panes.map((pane: unknown) => {
			if (!isRecord(pane)) return pane;
			const { pinned: _, ...legacy } = pane;
			return legacy;
		});
	}
	if (isRecord(rightPaneLayout) && Array.isArray(rightPaneLayout.tabs)) {
		const center = Array.isArray(workspace.paneTabs) ? workspace.paneTabs : [];
		const tabs: unknown[] = [...center, ...rightPaneLayout.tabs];
		const selected =
			activePaneArea === "right"
				? rightPaneLayout.activeTabId
				: workspace.activePaneTabId;
		const tab =
			tabs.find((tab) => isRecord(tab) && tab.tabId === selected) ??
			tabs.find(
				(tab) => isRecord(tab) && tab.tabId === rightPaneLayout.activeTabId,
			) ??
			tabs[0];
		workspace.paneTabs = tabs;
		workspace.activePaneTabId = isRecord(tab) ? tab.tabId : null;
		workspace.activePaneId = isRecord(tab) ? tab.activePaneId : null;
	}
	return workspace;
}
function flattenView(value: unknown): unknown {
	if (!isRecord(value) || !Array.isArray(value.targets)) return value;
	return {
		...value,
		targets: value.targets.map((target: unknown) =>
			isRecord(target) && Array.isArray(target.workspaces)
				? { ...target, workspaces: target.workspaces.map(flattenWorkspace) }
				: target,
		),
	};
}
function selectedTab(
	tabs: NonNullable<WorkspaceViewV3["paneTabs"]>,
	id: string | null | undefined,
) {
	const active = tabs.find((tab) => tab.tabId === id);
	if (tabs.length === 0 ? id !== null : !active)
		throw new Error("Invalid pane area selection");
	return active;
}
function parseAndProject(value: unknown): {
	view: WorkspaceViewInputV3;
	legacy: WorkspaceViewInputV2;
} {
	const encoded = JSON.stringify(value);
	if (!encoded || new TextEncoder().encode(encoded).length > 2 * 1024 * 1024)
		throw new Error("Workspace view size limit exceeded");
	const input: unknown = JSON.parse(encoded);
	const legacy = validateWorkspaceViewV2(flattenView(input));
	const view = workspaceViewInputV3Schema.parse(input);
	for (const target of view.targets) {
		for (const workspace of target.workspaces) {
			const right = workspace.rightPaneLayout;
			if (!right) {
				if (
					workspace.rightPaneOpen !== undefined ||
					workspace.activePaneArea !== undefined
				)
					throw new Error("Pane area metadata requires a right layout");
				continue;
			}
			if (!workspace.paneTabs)
				throw new Error("Both pane area layouts must be saved together");
			const centerTab = selectedTab(
				workspace.paneTabs,
				workspace.activePaneTabId,
			);
			const rightTab = selectedTab(right.tabs, right.activeTabId);
			const inRight = workspace.activePaneArea === "right";
			if (inRight && (!workspace.rightPaneOpen || !rightTab))
				throw new Error("A hidden or empty pane area cannot have focus");
			const focused = inRight ? rightTab : centerTab;
			if (workspace.activePaneId !== (focused?.activePaneId ?? null))
				throw new Error("Invalid focused pane area");
		}
	}
	return { view, legacy };
}

export function validateWorkspaceViewV3(value: unknown): WorkspaceViewInputV3 {
	return parseAndProject(value).view;
}
export function projectWorkspaceViewV2(
	view: WorkspaceViewInputV3,
): WorkspaceViewInputV2 {
	return parseAndProject(view).legacy;
}

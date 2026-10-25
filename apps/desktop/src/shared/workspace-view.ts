import type { RestoreResourceCheck } from "@superset/shared/workspace-restore";
import { z } from "zod";
import type { DirectDescriptor } from "./direct-workstation";

const id = z
	.string()
	.min(1)
	.max(128)
	.regex(/^[\w-]+$/);
const label = z.string().max(128).optional();
export type PaneTree =
	| { type: "pane"; paneId: string }
	| {
			type: "split";
			axis: "horizontal" | "vertical";
			ratio: number;
			first: PaneTree;
			second: PaneTree;
	  };
export interface WorkspacePane {
	paneId: string;
	kind: "terminal" | "chat";
	resourceId: string;
	executionId?: string;
	label?: string;
}
const pane = z
	.strictObject({
		paneId: id,
		kind: z.enum(["terminal", "chat"]),
		resourceId: id,
		executionId: id.optional(),
		label,
	})
	.refine((value) => value.kind !== "chat" || value.executionId === undefined);
const tree: z.ZodType<PaneTree> = z.lazy(() =>
	z.discriminatedUnion("type", [
		z.strictObject({ type: z.literal("pane"), paneId: id }),
		z.strictObject({
			type: z.literal("split"),
			axis: z.enum(["horizontal", "vertical"]),
			ratio: z.number().min(0.1).max(0.9),
			first: tree,
			second: tree,
		}),
	]),
);
const workspace = z.strictObject({
	tabId: id,
	workspaceId: id,
	label,
	activeTool: z.enum(["terminal", "chat", "files"]),
	activePaneId: id.nullable(),
	panes: z.array(pane).max(64),
	layout: tree.nullable(),
	paneTabs: z
		.array(
			z.strictObject({
				tabId: id,
				label,
				createdAt: z.number().int().nonnegative(),
				activePaneId: id.nullable(),
				layout: tree,
			}),
		)
		.max(64)
		.optional(),
	activePaneTabId: id.nullable().optional(),
});
const target = z.strictObject({
	connectionId: id,
	targetRevision: z.number().int().min(1),
	backendId: id,
	namespaceId: id,
	serviceUid: z.number().int().min(1),
	autoConnect: z.boolean(),
	activeTabId: id.nullable(),
	workspaces: z.array(workspace).max(20),
});
export const workspaceViewInputSchema = z.strictObject({
	restoreOnLaunch: z.boolean(),
	activeConnectionId: id.nullable(),
	targets: z.array(target).max(10),
	window: z.strictObject({
		x: z.number().int().min(-2147483648).max(2147483647),
		y: z.number().int().min(-2147483648).max(2147483647),
		width: z.number().int().min(1).max(32768),
		height: z.number().int().min(1).max(32768),
		maximized: z.boolean(),
	}),
});
export type WorkspaceViewInput = z.infer<typeof workspaceViewInputSchema>;
export type WorkspaceView =
	WorkspaceViewInput["targets"][number]["workspaces"][number];
export type TargetView = WorkspaceViewInput["targets"][number];
export interface WorkspaceViewSnapshot extends WorkspaceViewInput {
	schemaVersion: 1;
	revision: number;
	updatedAt: number;
}

export interface WorkspaceRestoreSnapshot {
	jobId: string;
	sequence: number;
	viewRevision: number;
	navigationRevision: number;
	connectionId: string | null;
	status: "connecting" | "checking" | "ready" | "paused" | "cancelled";
	reason?:
		| "disconnected"
		| "target-changed"
		| "identity-changed"
		| "unsupported"
		| "unavailable"
		| "invalid-view";
	descriptor?: DirectDescriptor;
	authenticatedAt?: number;
	resources: RestoreResourceCheck[];
}

export function emptyWorkspaceView(
	window: WorkspaceViewInput["window"],
): WorkspaceViewInput {
	return {
		restoreOnLaunch: true,
		activeConnectionId: null,
		targets: [],
		window,
	};
}

export type WorkspaceViewStructure = Omit<WorkspaceViewInput, "targets"> & {
	targets: (Omit<TargetView, "workspaces"> & {
		workspaces: (Omit<WorkspaceView, "panes"> & {
			panes: { paneId: string; kind: string; resourceId: string }[];
		})[];
	})[];
};

export function validateWorkspaceView(value: unknown): WorkspaceViewInput {
	return validateWorkspaceViewWithSchema(value, workspaceViewInputSchema);
}

export function validateWorkspaceViewWithSchema<
	TView extends WorkspaceViewStructure,
>(value: unknown, schema: z.ZodType<TView>): TView {
	const encoded = JSON.stringify(value);
	if (!encoded || new TextEncoder().encode(encoded).length > 2 * 1024 * 1024)
		throw new Error("Workspace view size limit exceeded");
	const input = JSON.parse(encoded) as unknown;
	const checkDepth = (node: unknown, depth: number): void => {
		if (depth > 16) throw new Error("Workspace layout depth limit exceeded");
		if (
			node &&
			typeof node === "object" &&
			"type" in node &&
			node.type === "split"
		) {
			checkDepth("first" in node ? node.first : undefined, depth + 1);
			checkDepth("second" in node ? node.second : undefined, depth + 1);
		}
	};
	if (
		input &&
		typeof input === "object" &&
		"targets" in input &&
		Array.isArray(input.targets)
	)
		for (const t of input.targets)
			if (Array.isArray(t?.workspaces))
				for (const w of t.workspaces) {
					checkDepth(w?.layout, 1);
					if (Array.isArray(w?.paneTabs))
						for (const tab of w.paneTabs) checkDepth(tab?.layout, 1);
				}
	const view = schema.parse(input);
	let tabs = 0;
	let panes = 0;
	const targets = new Set<string>();
	for (const t of view.targets) {
		if (targets.has(t.connectionId)) throw new Error("Duplicate target");
		targets.add(t.connectionId);
		const tabIds = new Set<string>();
		const workspaceIds = new Set<string>();
		const resources = new Set<string>();
		for (const w of t.workspaces) {
			if (tabIds.has(w.tabId) || workspaceIds.has(w.workspaceId))
				throw new Error("Duplicate workspace tab");
			tabIds.add(w.tabId);
			workspaceIds.add(w.workspaceId);
			tabs++;
			panes += w.panes.length;
			const paneIds = new Set<string>();
			for (const p of w.panes) {
				const resource = `${p.kind}:${p.resourceId}`;
				if (paneIds.has(p.paneId) || resources.has(resource))
					throw new Error("Duplicate workspace pane");
				paneIds.add(p.paneId);
				resources.add(resource);
			}
			const seen = new Set<string>();
			const walk = (node: PaneTree): void => {
				if (node.type === "split") {
					walk(node.first);
					walk(node.second);
					return;
				}
				if (!paneIds.has(node.paneId) || seen.has(node.paneId))
					throw new Error("Invalid layout reference");
				seen.add(node.paneId);
			};
			if (w.layout) walk(w.layout);
			if (
				seen.size !== paneIds.size ||
				(w.activePaneId !== null && !paneIds.has(w.activePaneId))
			)
				throw new Error("Invalid workspace pane references");
			if ((w.paneTabs === undefined) !== (w.activePaneTabId === undefined))
				throw new Error(
					"Terminal tabs and their active tab must be saved together",
				);
			if (w.paneTabs !== undefined) {
				const groupIds = new Set<string>(),
					groupedPanes = new Set<string>();
				for (const tab of w.paneTabs) {
					if (groupIds.has(tab.tabId))
						throw new Error("Duplicate terminal tab");
					groupIds.add(tab.tabId);
					const members = new Set<string>();
					const walkGroup = (node: PaneTree): void => {
						if (node.type === "split") {
							walkGroup(node.first);
							walkGroup(node.second);
							return;
						}
						if (!paneIds.has(node.paneId) || groupedPanes.has(node.paneId))
							throw new Error("Invalid terminal tab pane reference");
						members.add(node.paneId);
						groupedPanes.add(node.paneId);
					};
					walkGroup(tab.layout);
					if (tab.activePaneId === null || !members.has(tab.activePaneId))
						throw new Error("Invalid terminal tab focus");
				}
				if (groupedPanes.size !== paneIds.size)
					throw new Error(
						"Terminal tabs must contain every workspace pane exactly once",
					);
				const active = w.paneTabs.find(
					(tab) => tab.tabId === w.activePaneTabId,
				);
				if (
					w.paneTabs.length === 0
						? w.activePaneTabId !== null || w.activePaneId !== null
						: !active || active.activePaneId !== w.activePaneId
				)
					throw new Error("Invalid active terminal tab");
			}
		}
		if (t.activeTabId !== null && !tabIds.has(t.activeTabId))
			throw new Error("Invalid active tab");
	}
	if (tabs > 20 || panes > 64)
		throw new Error("Workspace view capacity exceeded");
	if (view.activeConnectionId !== null && !targets.has(view.activeConnectionId))
		throw new Error("Invalid active target");
	return view;
}

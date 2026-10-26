import { createWorkspaceStore, type WorkspaceState } from "@superset/panes";
import { preserveLocalPaneSelection } from "renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/hooks/useV2WorkspacePaneLayout/utils/preserveLocalPaneSelection";
import type { WorkspacePaneV2 } from "shared/workspace-view-v2";

type BrowserPane = Extract<WorkspacePaneV2, { kind: "browser" }>;
export function openWorkstationBrowserState({
	previous,
	pane,
	target = "current-tab",
	show = false,
}: {
	previous: WorkspaceState<WorkspacePaneV2>;
	pane: BrowserPane;
	target?: "current-tab" | "new-tab";
	show?: boolean;
}): {
	state: WorkspaceState<WorkspacePaneV2>;
	paneId: string;
	created: boolean;
	removedPaneIds: string[];
} {
	if (target !== "current-tab" && target !== "new-tab")
		throw Error("Invalid browser placement");
	const before = previous.tabs.flatMap((tab) => Object.values(tab.panes));
	const existing = before.find((candidate) => candidate.id === pane.paneId);
	if (existing) {
		if (
			existing.kind !== "browser" ||
			existing.data.kind !== "browser" ||
			existing.data.paneId !== pane.paneId ||
			existing.data.resourceId !== pane.resourceId
		)
			throw Error("Browser pane identity changed");
		return {
			state: previous,
			paneId: pane.paneId,
			created: false,
			removedPaneIds: [],
		};
	}
	if (before.some((candidate) => candidate.data.resourceId === pane.resourceId))
		throw Error("Browser resource identity already exists");
	const initial = structuredClone({
		version: previous.version,
		tabs: previous.tabs,
		activeTabId: previous.activeTabId,
	});
	const store = createWorkspaceStore({ initialState: initial });
	const input = {
		id: pane.paneId,
		kind: "browser",
		titleOverride: pane.label,
		data: structuredClone(pane),
	};
	if (target === "new-tab") store.getState().addTab({ panes: [input] });
	else store.getState().openPane({ pane: input });
	const opened = store.getState();
	const next = {
		version: opened.version,
		tabs: opened.tabs,
		activeTabId: opened.activeTabId,
	};
	const all = next.tabs.flatMap((tab) => Object.values(tab.panes));
	if (all.length > 64 || next.tabs.length > 64)
		throw Error("Browser pane limit exceeded");
	const known = new Set(all.map((candidate) => candidate.id));
	if (!known.has(pane.paneId))
		throw Error("Browser open did not create its pane");
	return {
		state: show ? next : preserveLocalPaneSelection(previous, next),
		paneId: pane.paneId,
		created: true,
		removedPaneIds: before
			.filter((candidate) => !known.has(candidate.id))
			.map((candidate) => candidate.id),
	};
}

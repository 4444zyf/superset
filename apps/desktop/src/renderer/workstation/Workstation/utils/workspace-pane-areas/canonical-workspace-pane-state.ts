import type { LayoutNode, WorkspaceState } from "@superset/panes";
import type { WorkspaceViewV3 } from "shared/workspace-view-v3";
import { fromPaneLayout, toPaneLayout } from "../pane-adapter/pane-adapter";

type State = WorkspaceState<WorkspaceViewV3["panes"][number]>;
export function canonicalWorkspacePaneState(state: State): State {
	if (state.tabs.length > 64) throw Error("Pane area tab limit exceeded");
	let nodes = 0;
	const check = (layout: LayoutNode, depth = 1): void => {
		if (depth > 16 || ++nodes > 127)
			throw Error("Pane area layout limit exceeded");
		if (layout.type === "split") {
			check(layout.first, depth + 1);
			check(layout.second, depth + 1);
		}
	};
	return {
		...state,
		tabs: state.tabs.map((tab) => {
			check(tab.layout);
			return { ...tab, layout: toPaneLayout(fromPaneLayout(tab.layout)) };
		}),
	};
}

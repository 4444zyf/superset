import { expect, test } from "bun:test";
import { createWorkspaceStore } from "@superset/panes";
import {
	fixture,
	required,
	workspace,
} from "../../../../../main/lib/ssh-direct/workspace-view-area-fixtures.test-data";
import { toPaneState } from "../pane-adapter/pane-adapter";
import { applyWorkspacePaneState } from "../workspace-pane-state/workspace-pane-state";
import { editWorkspacePaneArea } from "./workspace-pane-area-edit";

const scope = (view: ReturnType<typeof fixture>) => ({
	...required(view.targets[0]),
	workspaceId: "workspace",
	tabId: "workspace-tab",
});
test("an original right-pane close edits one area and retains the center resource, pin and layout", () => {
	const view = fixture(),
		before = structuredClone(view);
	const result = required(
		editWorkspacePaneArea(
			view,
			scope(view),
			{ paneId: "browser", focus: false },
			(w) => {
				const prior = toPaneState(w),
					store = createWorkspaceStore({ initialState: prior }),
					found = required(store.getState().getPane("browser"));
				store.getState().closePane({
					tabId: found.tabId,
					paneId: "browser",
					intent: "remove",
				});
				expect(applyWorkspacePaneState(w, store.getState(), prior)).toBe(true);
			},
		),
	);
	expect(workspace(result).panes.map((p) => p.paneId)).toEqual(["terminal"]);
	expect(workspace(result).panes[0]?.pinned).toBe(true);
	expect(workspace(result).paneTabs).toEqual(workspace(view).paneTabs);
	expect(workspace(result).rightPaneLayout?.tabs).toEqual([]);
	expect(view).toEqual(before);
});
test("a right resource focus preserves center Files and reveals only its own area", () => {
	const view = fixture();
	workspace(view).activeTool = "files";
	const result = required(
		editWorkspacePaneArea(view, scope(view), { paneId: "browser" }, (w) => {
			w.activePaneId = "browser";
		}),
	);
	expect(workspace(result).activePaneArea).toBe("right");
	expect(workspace(result).rightPaneOpen).toBe(true);
	expect(workspace(result).activePaneId).toBe("browser");
	expect(workspace(result).activeTool).toBe("files");
});
test("a new center browser uses the original store while retaining hidden right resources", () => {
	const view = fixture(),
		result = required(
			editWorkspacePaneArea(view, scope(view), { area: "center" }, (w) => {
				const prior = toPaneState(w),
					store = createWorkspaceStore({ initialState: prior }),
					pane = {
						paneId: "new-browser",
						resourceId: "new-page",
						kind: "browser" as const,
						browser: {
							url: "http://localhost:3001/",
							pageTitle: "",
							faviconUrl: null,
						},
					};
				store.getState().addTab({
					id: "new-tab",
					panes: [{ id: pane.paneId, kind: pane.kind, data: pane }],
				});
				w.panes.push(pane);
				expect(applyWorkspacePaneState(w, store.getState(), prior)).toBe(true);
			}),
		);
	expect(workspace(result).panes).toHaveLength(3);
	expect(workspace(result).rightPaneLayout).toEqual(
		workspace(view).rightPaneLayout,
	);
	expect(workspace(result).rightPaneOpen).toBe(false);
	expect(workspace(result).activePaneId).toBe("new-browser");
});
test("execution or resource replacement clears an inherited pin", () => {
	const view = fixture();
	for (const key of ["resourceId", "executionId"] as const) {
		const result = required(
			editWorkspacePaneArea(view, scope(view), { paneId: "terminal" }, (w) => {
				required(w.panes[0])[key] = "replacement";
			}),
		);
		expect(
			workspace(result).panes.find((p) => p.paneId === "terminal")?.pinned,
		).toBeUndefined();
	}
});
test("a passive center edit does not steal the selected right resource", () => {
	const view = fixture(),
		w = workspace(view);
	w.rightPaneOpen = true;
	w.activePaneArea = "right";
	w.activePaneId = "browser";
	const result = required(
		editWorkspacePaneArea(
			view,
			scope(view),
			{ paneId: "terminal", focus: false },
			(w) => {
				required(w.panes[0]).label = "Renamed";
			},
		),
	);
	expect(workspace(result).activePaneId).toBe("browser");
	expect(workspace(result).activePaneArea).toBe("right");
	expect(workspace(result).panes[0]?.label).toBe("Renamed");
});
test("a right resource inserted into the center remains a duplicate after recombination", () => {
	const view = fixture(),
		before = structuredClone(view);
	let accepted = false;
	expect(
		editWorkspacePaneArea(view, scope(view), { area: "center" }, (w) => {
			const pane = structuredClone(
					required(workspace(view).panes.find((p) => p.paneId === "browser")),
				),
				prior = toPaneState(w),
				store = createWorkspaceStore({ initialState: prior });
			store.getState().addTab({
				id: "duplicate-tab",
				panes: [{ id: pane.paneId, kind: pane.kind, data: pane }],
			});
			w.panes.push(pane);
			accepted = applyWorkspacePaneState(w, store.getState(), prior);
		}),
	).toBeNull();
	expect(accepted).toBe(true);
	expect(view).toEqual(before);
});
test("old target identities and unknown pane owners cannot edit the current area", () => {
	const view = fixture();
	let called = 0;
	expect(
		editWorkspacePaneArea(
			view,
			{ ...scope(view), namespaceId: "old" },
			{ area: "center" },
			() => {
				called++;
			},
		),
	).toBeNull();
	expect(
		editWorkspacePaneArea(view, scope(view), { paneId: "unknown" }, () => {
			called++;
		}),
	).toBeNull();
	expect(called).toBe(0);
});

test("the original 64-pane limit counts the untouched right resource as well as new center tabs", () => {
	const view = fixture(),
		accepted: boolean[] = [];
	const add = (count: number) =>
		editWorkspacePaneArea(view, scope(view), { area: "center" }, (w) => {
			const prior = toPaneState(w),
				store = createWorkspaceStore({ initialState: prior });
			for (let i = 0; i < count; i++) {
				const pane = {
					paneId: `added-${i}`,
					resourceId: `page-${i}`,
					kind: "browser" as const,
					browser: {
						url: "http://localhost:3001/",
						pageTitle: "",
						faviconUrl: null,
					},
				};
				store.getState().addTab({
					id: `tab-${i}`,
					panes: [{ id: pane.paneId, kind: pane.kind, data: pane }],
				});
				w.panes.push(pane);
			}
			accepted.push(applyWorkspacePaneState(w, store.getState(), prior));
		});
	expect(workspace(required(add(62))).panes).toHaveLength(64);
	expect(add(63)).toBeNull();
	expect(accepted).toEqual([true, true]);
	expect(workspace(view).panes).toHaveLength(2);
});

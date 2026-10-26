import { expect, test } from "bun:test";
import { createWorkspaceStore, type WorkspaceState } from "@superset/panes";
import type { WorkspacePaneV2 } from "shared/workspace-view-v2";
import { openWorkstationBrowserState } from "./workspace-browser-open";

type BrowserPane = Extract<WorkspacePaneV2, { kind: "browser" }>;
const browser = (id: string): BrowserPane => ({
	paneId: id,
	kind: "browser",
	resourceId: `resource-${id}`,
	browser: {
		url: "http://localhost:3000/中文",
		pageTitle: "",
		faviconUrl: null,
	},
});
const terminal: WorkspacePaneV2 = {
	paneId: "terminal",
	kind: "terminal",
	resourceId: "terminal-resource",
	executionId: "execution",
};
function state(): WorkspaceState<WorkspacePaneV2> {
	return {
		version: 1,
		activeTabId: "tab",
		tabs: [
			{
				id: "tab",
				createdAt: 1,
				activePaneId: "terminal",
				layout: { type: "pane", paneId: "terminal" },
				panes: {
					terminal: { id: "terminal", kind: "terminal", data: terminal },
				},
			},
		],
	};
}
const ids = (value: WorkspaceState<WorkspacePaneV2>) =>
	value.tabs.flatMap((tab) => Object.keys(tab.panes));

test("a background current-tab open uses the original split engine without adopting its focus", () => {
	const before = state(),
		snapshot = structuredClone(before),
		pane = browser("created");
	const result = openWorkstationBrowserState({ previous: before, pane });
	expect(result.paneId).toBe("created");
	expect(result.created).toBe(true);
	expect(ids(result.state)).toEqual(["terminal", "created"]);
	expect(result.state.activeTabId).toBe("tab");
	expect(result.state.tabs[0]?.activePaneId).toBe("terminal");
	expect(result.removedPaneIds).toEqual([]);
	expect(before).toEqual(snapshot);
	expect(result.state.tabs[0]?.layout).toMatchObject({
		type: "split",
		direction: "horizontal",
	});
});

test("current-tab follows the original unpinned-browser replacement rule", () => {
	const previous = state(),
		store = createWorkspaceStore({ initialState: previous });
	store
		.getState()
		.openPane({ pane: { id: "old", kind: "browser", data: browser("old") } });
	const split = store.getState();
	store.getState().setActivePane({ tabId: "tab", paneId: "terminal" });
	const before = {
		version: split.version,
		tabs: store.getState().tabs,
		activeTabId: "tab",
	} as const;
	const result = openWorkstationBrowserState({
		previous: before,
		pane: browser("created"),
	});
	expect(ids(result.state)).toEqual(["terminal", "created"]);
	expect(result.removedPaneIds).toEqual(["old"]);
	expect(result.state.tabs[0]?.activePaneId).toBe("terminal");
});

test("an original pinned browser remains intact when current-tab opens another browser", () => {
	const store = createWorkspaceStore({ initialState: state() });
	store.getState().openPane({
		pane: {
			id: "pinned",
			kind: "browser",
			pinned: true,
			data: browser("pinned"),
		},
	});
	store.getState().setActivePane({ tabId: "tab", paneId: "terminal" });
	const result = openWorkstationBrowserState({
		previous: store.getState(),
		pane: browser("created"),
	});
	expect(ids(result.state)).toEqual(["terminal", "pinned", "created"]);
	expect(result.state.tabs[0]?.panes.pinned?.pinned).toBe(true);
	expect(result.removedPaneIds).toEqual([]);
	expect(result.state.tabs[0]?.activePaneId).toBe("terminal");
});

test("new-tab background creation retains the previous tab and show explicitly selects the new browser", () => {
	const previous = state();
	const background = openWorkstationBrowserState({
		previous,
		pane: browser("background"),
		target: "new-tab",
	});
	expect(background.state.tabs).toHaveLength(2);
	expect(background.state.activeTabId).toBe("tab");
	expect(background.state.tabs[0]?.activePaneId).toBe("terminal");
	const shown = openWorkstationBrowserState({
		previous,
		pane: browser("shown"),
		target: "new-tab",
		show: true,
	});
	expect(shown.state.activeTabId).not.toBe("tab");
	expect(
		shown.state.tabs.find((tab) => tab.id === shown.state.activeTabId)
			?.activePaneId,
	).toBe("shown");
});

test("a repeated resource keeps its current page and selection without creating or focusing again", () => {
	const first = openWorkstationBrowserState({
		previous: state(),
		pane: browser("created"),
		target: "new-tab",
	});
	const tab = first.state.tabs.find((tab) => tab.panes.created);
	if (!tab) throw Error("Missing created browser");
	const pane = tab.panes.created;
	if (!pane || pane.data.kind !== "browser") throw Error("Wrong created pane");
	pane.data.browser.url = "http://localhost:3000/now-current";
	const result = openWorkstationBrowserState({
		previous: first.state,
		pane: browser("created"),
		show: true,
	});
	expect(result.created).toBe(false);
	expect(result.state).toBe(first.state);
	expect(result.state.activeTabId).toBe("tab");
	expect(ids(result.state)).toHaveLength(2);
	expect(() =>
		openWorkstationBrowserState({
			previous: first.state,
			pane: { ...browser("created"), resourceId: "foreign-resource" },
		}),
	).toThrow("identity");
});

test("the pane limit permits an original replacement but refuses another tab without mutating input", () => {
	const store = createWorkspaceStore<WorkspacePaneV2>();
	store.getState().addTab({
		panes: [
			{ id: "browser-0", kind: "browser", data: browser("browser-0") },
			...Array.from({ length: 63 }, (_, i) => ({
				id: `browser-${i + 1}`,
				kind: "browser",
				data: browser(`browser-${i + 1}`),
			})),
		],
	});
	const previous = {
		version: 1 as const,
		tabs: store.getState().tabs,
		activeTabId: store.getState().activeTabId,
	};
	const snapshot = structuredClone(previous);
	const replacement = openWorkstationBrowserState({
		previous,
		pane: browser("replacement"),
	});
	expect(ids(replacement.state)).toHaveLength(64);
	expect(replacement.removedPaneIds).toHaveLength(1);
	expect(() =>
		openWorkstationBrowserState({
			previous,
			pane: browser("overflow"),
			target: "new-tab",
		}),
	).toThrow("limit");
	expect(previous).toEqual(snapshot);
});

test("invalid placement and colliding resource identities never alter a workspace", () => {
	const previous = state(),
		snapshot = structuredClone(previous);
	expect(() =>
		openWorkstationBrowserState({
			previous,
			pane: browser("created"),
			target: "typo" as never,
		}),
	).toThrow();
	expect(() =>
		openWorkstationBrowserState({
			previous,
			pane: { ...browser("created"), resourceId: terminal.resourceId },
		}),
	).toThrow("identity");
	expect(previous).toEqual(snapshot);
});

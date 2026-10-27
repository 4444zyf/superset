import { expect, test } from "bun:test";
import { createWorkspaceStore, type WorkspaceState } from "@superset/panes";
import type { DirectWorkstationApi } from "shared/direct-workstation";
import type { WorkspacePaneV2 } from "shared/workspace-view-v2";
import { openWorkstationBrowserState } from "../workspace-browser-open/workspace-browser-open";
import {
	captureWorkstationPaneRuntime,
	registerWorkstationPaneRuntime,
	preserveRuntimePanePins,
} from "./workstation-pane-runtime";
function fixture() {
	const api = {} as DirectWorkstationApi,
		descriptor = {
			connectionId: crypto.randomUUID(),
			generation: 1,
			backendId: "backend",
			namespaceId: "namespace",
			instanceId: "instance",
		};
	const state: WorkspaceState<WorkspacePaneV2> = {
		version: 1,
		activeTabId: "tab",
		tabs: [
			{
				id: "tab",
				createdAt: 1,
				activePaneId: "terminal",
				layout: {
					type: "split",
					direction: "horizontal",
					first: { type: "pane", paneId: "terminal" },
					second: { type: "pane", paneId: "browser" },
				},
				panes: {
					terminal: {
						id: "terminal",
						kind: "terminal",
						data: {
							kind: "terminal",
							paneId: "terminal",
							resourceId: "pty",
							executionId: "execution",
						},
					},
					browser: {
						id: "browser",
						kind: "browser",
						data: {
							kind: "browser",
							paneId: "browser",
							resourceId: "page",
							browser: {
								url: "https://owned.invalid",
								pageTitle: "",
								faviconUrl: null,
							},
						},
					},
				},
			},
		],
	};
	const store = createWorkspaceStore({ initialState: state }),
		port = {
			read: () => store.getState(),
			replace: (next: typeof state) => store.getState().replaceState(next),
			subscribe: (listener: () => void) => store.subscribe(listener),
		};
	const register = () =>
			registerWorkstationPaneRuntime(
				api,
				descriptor,
				"workspace",
				"workspace-tab",
				port,
			),
		capture = () =>
			captureWorkstationPaneRuntime(
				api,
				descriptor,
				"workspace",
				"workspace-tab",
			);
	return { api, descriptor, state, store, port, register, capture };
}
test("pane runtime access is scoped to the API window, exact backend lease, workspace and source tab", () => {
	const f = fixture(),
		off = f.register();
	try {
		expect(f.capture()?.isCurrent()).toBe(true);
		for (const field of [
			"connectionId",
			"backendId",
			"namespaceId",
			"instanceId",
		] as const)
			expect(
				captureWorkstationPaneRuntime(
					f.api,
					{ ...f.descriptor, [field]: "other" },
					"workspace",
					"workspace-tab",
				),
			).toBeNull();
		expect(
			captureWorkstationPaneRuntime(
				f.api,
				{ ...f.descriptor, generation: 2 },
				"workspace",
				"workspace-tab",
			),
		).toBeNull();
		expect(
			captureWorkstationPaneRuntime(
				{} as DirectWorkstationApi,
				f.descriptor,
				"workspace",
				"workspace-tab",
			),
		).toBeNull();
		expect(
			captureWorkstationPaneRuntime(
				f.api,
				f.descriptor,
				"other",
				"workspace-tab",
			),
		).toBeNull();
		expect(
			captureWorkstationPaneRuntime(f.api, f.descriptor, "workspace", "other"),
		).toBeNull();
	} finally {
		off();
	}
});
test("a stale unregister cannot remove its replacement and the old capture is retired immediately", () => {
	const f = fixture(),
		oldOff = f.register(),
		old = f.capture()!;
	let cancelled = 0;
	old.watch(() => cancelled++);
	const off = f.register();
	try {
		expect(cancelled).toBe(1);
		expect(old.isCurrent()).toBe(false);
		oldOff();
		expect(f.capture()?.isCurrent()).toBe(true);
		expect(() => old.apply(f.state)).toThrow("layout changed");
	} finally {
		off();
	}
});
test("selection changes stay current and are preserved when applying a background open", () => {
	const f = fixture(),
		off = f.register();
	try {
		const captured = f.capture()!;
		let changes = 0;
		const stop = captured.watch(() => changes++);
		f.store.getState().setActivePane({ paneId: "browser", tabId: "tab" });
		expect(changes).toBe(0);
		expect(captured.unchanged()).toBe(true);
		const next = openWorkstationBrowserState({
			previous: captured.state,
			pane: {
				kind: "browser",
				paneId: "next",
				resourceId: "next-page",
				browser: {
					url: "https://next.invalid",
					pageTitle: "",
					faviconUrl: null,
				},
			},
			target: "new-tab",
			show: true,
		});
		stop();
		captured.apply(next.state);
		expect(f.store.getState().activeTabId).toBe("tab");
		expect(f.store.getState().tabs[0]?.activePaneId).toBe("browser");
		expect(f.store.getState().tabs).toHaveLength(2);
	} finally {
		off();
	}
});
test("pinning while a save is pending invalidates the captured layout and blocks its later apply", () => {
	const f = fixture(),
		off = f.register();
	try {
		const captured = f.capture()!;
		let changes = 0;
		captured.watch(() => changes++);
		f.store.getState().setPanePinned({ paneId: "browser", pinned: true });
		expect(changes).toBe(1);
		expect(captured.unchanged()).toBe(false);
		expect(() => captured.apply(captured.state)).toThrow("layout changed");
	} finally {
		off();
	}
});
test("same-resource hydration preserves runtime pins without inheriting a pin after replacement", () => {
	const f = fixture();
	f.store.getState().setPanePinned({ paneId: "browser", pinned: true });
	const next = structuredClone(f.state),
		before = structuredClone(next);
	const merged = preserveRuntimePanePins(f.store.getState(), next);
	expect(merged.tabs[0]?.panes.browser?.pinned).toBe(true);
	expect(next).toEqual(before);
	next.tabs[0]!.panes.browser!.data.resourceId = "replacement";
	expect(
		preserveRuntimePanePins(f.store.getState(), next).tabs[0]?.panes.browser
			?.pinned,
	).toBeUndefined();
});
test("closing the runtime retires and notifies a pending capture once", () => {
	const f = fixture(),
		off = f.register(),
		captured = f.capture()!;
	let cancelled = 0;
	captured.watch(() => cancelled++);
	off();
	off();
	expect(cancelled).toBe(1);
	expect(captured.unchanged()).toBe(false);
	expect(f.capture()).toBeNull();
});

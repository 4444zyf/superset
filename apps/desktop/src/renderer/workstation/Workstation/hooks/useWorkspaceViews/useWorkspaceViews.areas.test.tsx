import { afterEach, expect, test } from "bun:test";
import { transferTabToIndex } from "@superset/panes";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type {
	DirectDescriptor,
	DirectWorkstationApi,
} from "shared/direct-workstation";
import type { WorkspaceViewV2Save } from "shared/workspace-view-v2";
import type {
	WorkspaceViewSnapshotV3,
	WorkspaceViewV3Save,
} from "shared/workspace-view-v3";
import { validateWorkspaceViewV3 } from "shared/workspace-view-v3";
import {
	fixture,
	required,
	workspace,
} from "../../../../../main/lib/ssh-direct/workspace-view-area-fixtures.test-data";
import { projectBrowserOpenSnapshotV2 } from "../../utils/workspace-browser-open/workspace-browser-open-view-v3";
import { createWorkspacePaneAreas } from "../../utils/workspace-pane-areas/workspace-pane-areas";
import { useWorkspaceViews } from "./useWorkspaceViews";

afterEach(cleanup);
function setup(enabled = true, complete = true) {
	let backing: WorkspaceViewSnapshotV3 = {
			...fixture(),
			restoreOnLaunch: false,
			schemaVersion: 3,
			revision: 1,
			updatedAt: 1,
		},
		navigation = 0,
		reads2 = 0,
		reads3 = 0;
	let nextGate: Promise<void> | undefined, release: (() => void) | undefined;
	const saves3: WorkspaceViewV3Save[] = [],
		saves2: WorkspaceViewV2Save[] = [],
		errors: string[] = [];
	const descriptor: DirectDescriptor = {
		connectionId: "local",
		generation: 1,
		backendId: "backend",
		namespaceId: "namespace",
		instanceId: "instance",
		capabilities: { workspaceViewRestoreV1: true },
	};
	const api = {
		async getWorkspaceView() {
			throw Error("Unexpected V1 read");
		},
		async saveWorkspaceView() {
			throw Error("Unexpected V1 save");
		},
		async getWorkspaceViewV2() {
			reads2++;
			return {
				snapshot: projectBrowserOpenSnapshotV2(backing),
				revision: backing.revision,
				invalid: false,
				navigationRevision: navigation,
			};
		},
		async saveWorkspaceViewV2(input: WorkspaceViewV2Save) {
			saves2.push(input);
			return {
				...input.view,
				schemaVersion: 2,
				revision: ++backing.revision,
				updatedAt: 2,
			};
		},
		async getWorkspaceViewV3() {
			reads3++;
			const gate = nextGate;
			nextGate = undefined;
			if (gate) await gate;
			return {
				snapshot: structuredClone(backing),
				revision: backing.revision,
				invalid: false,
				navigationRevision: navigation,
			};
		},
		async saveWorkspaceViewV3(input: WorkspaceViewV3Save) {
			saves3.push(input);
			expect(input.expectedRevision).toBe(backing.revision);
			navigation = input.navigationRevision;
			backing = {
				...validateWorkspaceViewV3(input.view),
				schemaVersion: 3,
				revision: backing.revision + 1,
				updatedAt: 2,
			};
			return structuredClone(backing);
		},
		async beginWorkspaceRestore() {
			throw Error("Must not connect");
		},
		async rpc() {
			return [];
		},
		browser: {
			history: {},
			async navigate() {},
			async updatePage() {
				return {
					status: "saved",
					snapshot: projectBrowserOpenSnapshotV2(backing),
				};
			},
			openRequests: { saveViewV3: complete ? async () => backing : undefined },
		},
	} as unknown as DirectWorkstationApi;
	const hook = renderHook(() =>
		useWorkspaceViews(
			api,
			descriptor,
			{
				onSkeleton() {},
				onForget() {},
				async onDescriptor() {},
				onError: (message) => errors.push(message),
			},
			{ paneAreas: enabled },
		),
	);
	return {
		api,
		hook,
		descriptor,
		saves3,
		saves2,
		errors,
		backing: () => backing,
		reads2: () => reads2,
		reads3: () => reads3,
		gate() {
			nextGate = new Promise<void>((resolve) => {
				release = resolve;
			});
		},
		release() {
			required(release)();
		},
	};
}
test("the opt-in view hook reads full V3 while default and incomplete interfaces remain V2", async () => {
	for (const [enabled, complete] of [
		[true, true],
		[false, true],
		[true, false],
	] as const) {
		const f = setup(enabled, complete);
		await waitFor(() => expect(f.hook.result.current.view?.revision).toBe(1));
		expect(f.hook.result.current.paneAreasEnabled).toBe(enabled && complete);
		expect(f.hook.result.current.view?.schemaVersion).toBe(
			enabled && complete ? 3 : 2,
		);
		expect(enabled && complete ? f.reads2() : f.reads3()).toBe(0);
		f.hook.unmount();
	}
});
test("a V3 hook saves global changes without flattening right layout or fixed flags", async () => {
	const f = setup();
	await waitFor(() => expect(f.hook.result.current.view?.revision).toBe(1));
	await act(async () => {
		await f.hook.result.current.setRestoreOnLaunch(true);
	});
	expect(f.saves3).toHaveLength(1);
	expect(f.saves2).toHaveLength(0);
	expect(workspace(f.backing()).rightPaneLayout?.tabs).toHaveLength(1);
	expect(workspace(f.backing()).panes[0]?.pinned).toBe(true);
	expect(f.errors).toEqual([]);
});
test("accepting a legacy browser receipt waits for a full V3 refresh and preserves newer local tool intent", async () => {
	const f = setup();
	await waitFor(() => expect(f.hook.result.current.view?.revision).toBe(1));
	f.backing().revision = 2;
	const ack = projectBrowserOpenSnapshotV2(f.backing());
	f.gate();
	let pending: Promise<unknown> | undefined;
	act(() => {
		pending = Promise.resolve(
			f.hook.result.current.acceptBrowserOpen(ack, "local", "workspace", false),
		);
	});
	expect(f.hook.result.current.view?.revision).toBe(1);
	await act(async () => {
		await f.hook.result.current.setTool("workspace", "files");
	});
	await act(async () => {
		f.release();
		await pending;
	});
	expect(f.hook.result.current.view?.schemaVersion).toBe(3);
	expect(workspace(required(f.hook.result.current.view)).activeTool).toBe(
		"files",
	);
	expect(
		workspace(required(f.hook.result.current.view)).rightPaneLayout?.tabs,
	).toHaveLength(1);
	expect(f.errors).toEqual([]);
});
test("a legacy receipt cannot repopulate a scope after navigation changes during its refresh", async () => {
	const f = setup();
	await waitFor(() => expect(f.hook.result.current.view?.revision).toBe(1));
	f.backing().revision = 2;
	const ack = projectBrowserOpenSnapshotV2(f.backing());
	f.gate();
	let pending: Promise<unknown> | undefined;
	act(() => {
		pending = Promise.resolve(
			f.hook.result.current.acceptBrowserOpen(ack, "local", "workspace", false),
		).catch((error) => error);
	});
	act(() => f.hook.result.current.navigate());
	await act(async () => {
		f.release();
		const error = await pending;
		if (!(error instanceof Error)) throw Error("Missing cancelled receipt");
		expect(error.message).toContain("scope changed");
	});
	expect(f.hook.result.current.view?.revision).toBe(1);
	expect(f.errors).toEqual([]);
});

test("the real hook saves both original stores after an atomic cross-area transfer", async () => {
	const f = setup();
	await waitFor(() => expect(f.hook.result.current.view?.revision).toBe(1));
	const areas = createWorkspacePaneAreas(workspace(f.backing()), {
			scheduleMicrotask() {},
		}),
		before = areas.read();
	try {
		transferTabToIndex({
			source: areas.center,
			target: areas.right,
			tabId: "center-tab",
		});
		areas.activate("right");
		await act(async () => {
			await f.hook.result.current.savePaneAreas(
				"workspace",
				areas.read(),
				before,
			);
		});
		const w = workspace(f.backing());
		expect(w.panes).toHaveLength(2);
		expect(w.paneTabs).toEqual([]);
		expect(w.rightPaneLayout?.tabs).toHaveLength(2);
		expect(w.activePaneArea).toBe("right");
		expect(w.panes[0]?.pinned).toBe(true);
		expect(f.saves3).toHaveLength(1);
		expect(f.saves3[0]?.browserLeases).toEqual([
			{ connectionId: "local", generation: 1 },
		]);
		expect(f.errors).toEqual([]);
	} finally {
		areas.dispose();
	}
});
test("browser page updates refresh V3 instead of replacing the full view with their V2 projection", async () => {
	const f = setup();
	await waitFor(() => expect(f.hook.result.current.view?.revision).toBe(1));
	const reads = f.reads3();
	await act(async () => {
		f.hook.result.current.persistBrowserPage({
			pane: {
				connectionId: "local",
				generation: 1,
				workspaceId: "workspace",
				paneId: "browser",
				registrationId: "registration",
			},
			resourceId: "browser-resource",
			state: {
				url: "http://localhost:3001/",
				pageTitle: "Updated",
				faviconUrl: null,
			},
		});
		await f.hook.result.current.flush();
	});
	expect(f.reads3()).toBeGreaterThan(reads);
	expect(f.hook.result.current.view?.schemaVersion).toBe(3);
	expect(
		workspace(required(f.hook.result.current.view)).rightPaneLayout?.tabs,
	).toHaveLength(1);
	expect(f.errors).toEqual([]);
});

test("an unmounted hook rejects a late browser receipt without accepting its refreshed view", async () => {
	const f = setup();
	await waitFor(() => expect(f.hook.result.current.view?.revision).toBe(1));
	f.backing().revision = 2;
	f.gate();
	const pending = Promise.resolve(
		f.hook.result.current.acceptBrowserOpen(
			projectBrowserOpenSnapshotV2(f.backing()),
			"local",
			"workspace",
			false,
		),
	).catch((error) => error);
	f.hook.unmount();
	f.release();
	const error = await pending;
	if (!(error instanceof Error)) throw Error("Missing retired view error");
	expect(error.message).toContain("scope changed");
	expect(f.errors).toEqual([]);
});

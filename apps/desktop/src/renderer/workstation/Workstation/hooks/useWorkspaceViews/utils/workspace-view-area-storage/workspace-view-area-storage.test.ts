import { expect, test } from "bun:test";
import {
	fixture,
	required,
	workspace,
} from "../../../../../../../main/lib/ssh-direct/workspace-view-area-fixtures.test-data";
import type {
	WorkspaceViewSnapshotV3,
	WorkspaceViewV3Save,
} from "../../../../../../../shared/workspace-view-v3";
import { projectBrowserOpenSnapshotV2 } from "../../../../utils/workspace-browser-open/workspace-browser-open-view-v3";
import { createWorkspaceViewAreaStorage } from "./workspace-view-area-storage";

function setup() {
	let saved: WorkspaceViewSnapshotV3 = {
		...fixture(),
		schemaVersion: 3,
		revision: 2,
		updatedAt: 2,
	};
	let current = structuredClone(saved),
		reads = 0,
		active = true,
		navigationRevision = 4,
		invalid = false;
	let release: (() => void) | undefined,
		block = false;
	const writes: WorkspaceViewV3Save[] = [];
	const api = {
		async getWorkspaceViewV3() {
			expect(this).toBe(api);
			reads++;
			if (block)
				await new Promise<void>((resolve) => {
					release = resolve;
				});
			return {
				revision: saved.revision,
				snapshot: saved,
				invalid,
				navigationRevision,
			};
		},
		async saveWorkspaceViewV3(input: WorkspaceViewV3Save) {
			expect(this).toBe(api);
			writes.push(input);
			return saved;
		},
		browser: {
			openRequests: {
				async saveViewV3() {
					return saved;
				},
			},
		},
	};
	const storage = () => required(createWorkspaceViewAreaStorage(api, true));
	const options = {
		navigationRevision: 4,
		current: () => current,
		isCurrent: () => active,
		connectionId: "local",
		workspaceId: "workspace",
		show: false,
	};
	return {
		api,
		storage,
		options,
		writes,
		reads: () => reads,
		ack: () => projectBrowserOpenSnapshotV2(saved),
		current: () => current,
		saved: () => saved,
		active: (value: boolean) => {
			active = value;
		},
		navigation: (value: number) => {
			navigationRevision = value;
		},
		invalid: (value: boolean) => {
			invalid = value;
		},
		replace: (value: WorkspaceViewSnapshotV3) => {
			saved = value;
		},
		block: () => {
			block = true;
		},
		release: () => required(release)(),
	};
}
test("V3 storage requires an explicit opt-in and all three area-aware methods", () => {
	const f = setup();
	expect(createWorkspaceViewAreaStorage(f.api)).toBeNull();
	expect(
		createWorkspaceViewAreaStorage(
			{ ...f.api, getWorkspaceViewV3: undefined },
			true,
		),
	).toBeNull();
	expect(
		createWorkspaceViewAreaStorage(
			{ ...f.api, saveWorkspaceViewV3: undefined },
			true,
		),
	).toBeNull();
	expect(
		createWorkspaceViewAreaStorage({ ...f.api, browser: undefined }, true),
	).toBeNull();
	expect(
		createWorkspaceViewAreaStorage(
			{ ...f.api, browser: { openRequests: {} } },
			true,
		),
	).toBeNull();
	expect(f.reads()).toBe(0);
});
test("the V3 storage uses the original API receiver and forwards the exact guarded save input", async () => {
	const f = setup(),
		s = f.storage();
	expect((await s.read()).snapshot).toBe(f.saved());
	const { schemaVersion: _, revision: __, updatedAt: ___, ...view } = f.saved();
	const input = { expectedRevision: 2, navigationRevision: 4, view };
	expect(await s.save(input)).toBe(f.saved());
	expect(f.writes).toEqual([input]);
	expect(f.writes[0]).toBe(input);
});
test("a V2 receipt refreshes full V3 data and observes a right-focus change made during the read", async () => {
	const f = setup(),
		s = f.storage(),
		ack = f.ack();
	f.block();
	const pending = s.refreshAfterLegacy(ack, f.options);
	const w = workspace(f.current());
	w.rightPaneOpen = true;
	w.activePaneArea = "right";
	w.activePaneId = "browser";
	w.activeTool = "files";
	f.release();
	const result = await pending;
	expect(result.status).toBe("ready");
	if (result.status !== "ready") throw Error("Missing refreshed snapshot");
	expect(workspace(required(result.snapshot)).activePaneId).toBe("browser");
	expect(workspace(required(result.snapshot)).activeTool).toBe("files");
	expect(
		workspace(required(result.snapshot)).rightPaneLayout?.tabs,
	).toHaveLength(1);
	expect(workspace(required(result.snapshot)).panes[0]?.pinned).toBe(true);
	expect(f.reads()).toBe(1);
});
test("a retired view skips reads and a scope retired while reading cannot accept a receipt", async () => {
	const f = setup(),
		s = f.storage();
	f.active(false);
	expect(await s.refreshAfterLegacy(f.ack(), f.options)).toEqual({
		status: "stale",
	});
	expect(f.reads()).toBe(0);
	f.active(true);
	f.block();
	const pending = s.refreshAfterLegacy(f.ack(), f.options);
	f.active(false);
	f.release();
	expect(await pending).toEqual({ status: "stale" });
});
test("a navigation changed during refresh discards the old receipt", async () => {
	const f = setup();
	f.block();
	const pending = f.storage().refreshAfterLegacy(f.ack(), f.options);
	f.navigation(5);
	f.release();
	expect(await pending).toEqual({ status: "stale" });
});
test("a refresh older than the acknowledgement fails instead of relabeling a V2 snapshot", async () => {
	const f = setup(),
		ack = f.ack();
	f.saved().revision = 1;
	await expect(f.storage().refreshAfterLegacy(ack, f.options)).rejects.toThrow(
		"older than",
	);
});
test("invalid storage and identity changes cannot replace a current pane area view", async () => {
	const f = setup();
	f.invalid(true);
	await expect(
		f.storage().refreshAfterLegacy(f.ack(), f.options),
	).rejects.toThrow("unavailable");
	f.invalid(false);
	required(f.saved().targets[0]).namespaceId = "other";
	await expect(
		f.storage().refreshAfterLegacy(f.ack(), f.options),
	).rejects.toThrow("identity changed");
});
test("a receipt cannot recreate a forgotten view or erase a newer local view", async () => {
	const f = setup();
	const storage = required(
		createWorkspaceViewAreaStorage(
			{
				...f.api,
				async getWorkspaceViewV3() {
					return {
						revision: 3,
						snapshot: null,
						invalid: false,
						navigationRevision: 4,
					};
				},
			},
			true,
		),
	);
	expect(await storage.refreshAfterLegacy(f.ack(), f.options)).toEqual({
		status: "ready",
		snapshot: null,
		revision: 3,
	});
	f.current().revision = 4;
	expect(await storage.refreshAfterLegacy(f.ack(), f.options)).toEqual({
		status: "stale",
	});
});

import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import {
	projectWorkspaceViewV1,
	validateWorkspaceViewV2,
} from "../../../shared/workspace-view-v2";
import {
	projectWorkspaceViewV2,
	type WorkspaceViewInputV3,
} from "../../../shared/workspace-view-v3";
import {
	fixture,
	required,
	workspace,
} from "./workspace-view-area-fixtures.test-data";
import { WorkspaceViewStore } from "./workspace-view-store";

function database() {
	const db = new Database(":memory:"),
		store = new WorkspaceViewStore(db, () => 100);
	store.activateOwner("owner");
	return { db, store };
}
function input(
	snapshot: WorkspaceViewInputV3 & {
		schemaVersion: number;
		revision: number;
		updatedAt: number;
	},
): WorkspaceViewInputV3 {
	const { schemaVersion: _, revision: __, updatedAt: ___, ...view } = snapshot;
	return view;
}

test("V3 SQLite round-trips independent areas and exposes valid unchanged legacy shapes", () => {
	const { db, store } = database();
	try {
		const view = fixture(),
			saved = store.saveV3({ owner: "owner", expectedRevision: 0, view });
		expect(saved).toEqual({
			...view,
			schemaVersion: 3,
			revision: 1,
			updatedAt: 100,
		});
		expect(store.readV3().snapshot).toEqual(saved);
		expect(input(required(store.readV2().snapshot))).toEqual(
			projectWorkspaceViewV2(view),
		);
		expect(input(required(store.read().snapshot))).toEqual(
			projectWorkspaceViewV1(projectWorkspaceViewV2(view)),
		);
		expect(
			JSON.parse(
				required(
					db.query("SELECT snapshot FROM workspace_view").get() as {
						snapshot: string;
					},
				).snapshot,
			).schemaVersion,
		).toBe(3);
	} finally {
		store.close();
	}
});
test("legacy V2 and V1 saves retain both areas and fixed metadata", () => {
	const { store } = database();
	try {
		const view = fixture();
		store.saveV3({ owner: "owner", expectedRevision: 0, view });
		const v2 = input(required(store.readV2().snapshot));
		v2.window.width = 1000;
		store.saveV2({ owner: "owner", expectedRevision: 1, view: v2 });
		expect(input(required(store.readV3().snapshot))).toEqual({
			...view,
			window: { ...view.window, width: 1000 },
		});
		const v1 = store.read().snapshot;
		if (!v1) throw Error("Missing legacy view");
		const legacy = input(v1);
		legacy.window.height = 700;
		store.save({ owner: "owner", expectedRevision: 2, view: legacy });
		expect(
			workspace(input(required(store.readV3().snapshot))).rightPaneLayout,
		).toEqual(workspace(view).rightPaneLayout);
		expect(
			workspace(input(required(store.readV3().snapshot))).panes.map(
				(p) => p.pinned,
			),
		).toEqual([true, false]);
		expect(store.readV3().snapshot?.window.height).toBe(700);
	} finally {
		store.close();
	}
});
test("legacy saves preserve a closed populated right area and empty center", () => {
	const { store } = database();
	try {
		const view = fixture(),
			w = workspace(view);
		required(w.rightPaneLayout).tabs.push(...required(w.paneTabs));
		w.paneTabs = [];
		w.activePaneTabId = null;
		w.activePaneId = null;
		store.saveV3({ owner: "owner", expectedRevision: 0, view });
		store.saveV2({
			owner: "owner",
			expectedRevision: 1,
			view: input(required(store.readV2().snapshot)),
		});
		expect(input(required(store.readV3().snapshot))).toEqual(view);
	} finally {
		store.close();
	}
});
test("an unchanged V1 save keeps focus in the right browser omitted from its projection", () => {
	const { store } = database();
	try {
		const view = fixture(),
			w = workspace(view);
		w.rightPaneOpen = true;
		w.activePaneArea = "right";
		w.activePaneId = "browser";
		store.saveV3({ owner: "owner", expectedRevision: 0, view });
		const legacy = input(required(store.read().snapshot));
		expect(workspace(legacy).activePaneId).toBe("terminal");
		store.save({ owner: "owner", expectedRevision: 1, view: legacy });
		expect(input(required(store.readV3().snapshot))).toEqual(view);
	} finally {
		store.close();
	}
});
test("existing owner and revision checks protect V3 and legacy writes to V3", () => {
	const { store } = database();
	try {
		const view = fixture();
		store.saveV3({ owner: "owner", expectedRevision: 0, view });
		store.activateOwner("replacement");
		expect(() =>
			store.saveV3({ owner: "owner", expectedRevision: 1, view }),
		).toThrow("Workspace view owner changed");
		expect(() =>
			store.saveV2({
				owner: "owner",
				expectedRevision: 1,
				view: projectWorkspaceViewV2(view),
			}),
		).toThrow("Workspace view owner changed");
		expect(() =>
			store.saveV3({ owner: "replacement", expectedRevision: 0, view }),
		).toThrow("Workspace view revision changed");
		expect(store.readV3().revision).toBe(1);
	} finally {
		store.close();
	}
});
test("SQLite failure rolls back the existing transaction and permits a later valid V3 save", () => {
	const { db, store } = database();
	try {
		const view = fixture();
		store.saveV3({ owner: "owner", expectedRevision: 0, view });
		db.exec(
			"CREATE TRIGGER owned_failure BEFORE UPDATE ON workspace_view BEGIN SELECT RAISE(ABORT,'owned-write-failed'); END",
		);
		expect(() =>
			store.saveV3({ owner: "owner", expectedRevision: 1, view }),
		).toThrow("owned-write-failed");
		expect(store.readV3().revision).toBe(1);
		db.exec("DROP TRIGGER owned_failure");
		expect(
			store.saveV3({ owner: "owner", expectedRevision: 1, view }).revision,
		).toBe(2);
	} finally {
		store.close();
	}
});
test("invalid stored V3 is reported consistently and requires explicit clearing", () => {
	const { db, store } = database();
	try {
		const view = fixture();
		store.saveV3({ owner: "owner", expectedRevision: 0, view });
		const bad = {
			...structuredClone(view),
			schemaVersion: 3,
			revision: 1,
			updatedAt: 100,
		};
		workspace(bad).activePaneArea = "right";
		db.query("UPDATE workspace_view SET snapshot=?").run(JSON.stringify(bad));
		for (const result of [store.read(), store.readV2(), store.readV3()])
			expect(result).toEqual({ revision: 1, snapshot: null, invalid: true });
		expect(() =>
			store.saveV3({ owner: "owner", expectedRevision: 1, view }),
		).toThrow("The saved workspace view must be cleared before writing");
		expect(() =>
			store.saveV2({
				owner: "owner",
				expectedRevision: 1,
				view: projectWorkspaceViewV2(view),
			}),
		).toThrow("The saved workspace view must be cleared before writing");
		expect(store.forget({ owner: "owner", expectedRevision: 1 })).toBe(2);
		expect(store.readV3()).toEqual({
			revision: 2,
			snapshot: null,
			invalid: false,
		});
	} finally {
		store.close();
	}
});
test("namespace archival and restoration keep V3 metadata scoped to its original identity", () => {
	const { db, store } = database();
	try {
		const view = fixture(),
			identity = required(view.targets[0]);
		store.saveV3({ owner: "owner", expectedRevision: 0, view });
		store.selectLocalNamespace("owner", {
			...identity,
			namespaceId: "other",
			targetRevision: 2,
		});
		expect(store.readV3().snapshot?.targets).toEqual([]);
		store.selectLocalNamespace("owner", { ...identity, targetRevision: 3 });
		const restored = required(store.readV3().snapshot);
		expect(workspace(restored).rightPaneLayout).toEqual(
			workspace(view).rightPaneLayout,
		);
		expect(workspace(restored).panes.map((p) => p.pinned)).toEqual([
			true,
			false,
		]);
		expect(restored.targets[0]?.autoConnect).toBe(false);
		expect(restored.targets[0]?.targetRevision).toBe(3);
		const revision = store.readV3().revision;
		store.selectLocalNamespace("owner", { ...identity, targetRevision: 4 });
		expect(store.readV3().revision).toBe(revision);
		store.forget({ owner: "owner", expectedRevision: revision });
		expect(
			db.query("SELECT COUNT(*) AS count FROM local_namespace_views").get(),
		).toEqual({ count: 0 });
	} finally {
		store.close();
	}
});
test("an archived identity mismatch cannot replace the current V3 view", () => {
	const { db, store } = database();
	try {
		const view = fixture(),
			target = required(view.targets[0]);
		store.saveV3({ owner: "owner", expectedRevision: 0, view });
		const key = JSON.stringify([
			target.connectionId,
			target.backendId,
			"other",
			target.serviceUid,
		]);
		db.query("INSERT INTO local_namespace_views VALUES (?,?)").run(
			key,
			JSON.stringify({ ...target, namespaceId: "foreign" }),
		);
		expect(() =>
			store.selectLocalNamespace("owner", { ...target, namespaceId: "other" }),
		).toThrow("Local view identity changed");
		expect(input(required(store.readV3().snapshot))).toEqual(view);
		expect(store.readV3().revision).toBe(1);
	} finally {
		store.close();
	}
});
test("unextended legacy data retains the original physical format until explicitly saved as V3", () => {
	const { db, store } = database();
	try {
		const legacy = projectWorkspaceViewV2(fixture());
		validateWorkspaceViewV2(legacy);
		store.saveV2({ owner: "owner", expectedRevision: 0, view: legacy });
		const stored = () =>
			JSON.parse(
				required(
					db.query("SELECT snapshot FROM workspace_view").get() as {
						snapshot: string;
					},
				).snapshot,
			).schemaVersion;
		expect(stored()).toBe(2);
		expect(input(required(store.readV3().snapshot))).toEqual(legacy);
		store.saveV3({ owner: "owner", expectedRevision: 1, view: legacy });
		expect(stored()).toBe(3);
	} finally {
		store.close();
	}
});

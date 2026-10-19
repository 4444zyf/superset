import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import * as schema from "../../../db/schema";
import type { HostServiceContext } from "../../../types";
import { terminalPresetsRouter } from "./terminal-presets";

function fixture() {
	const sqlite = new Database(":memory:");
	const db = drizzle(sqlite, { schema });
	migrate(db, {
		migrationsFolder: resolve(import.meta.dir, "../../../../drizzle"),
	});
	const caller = () =>
		terminalPresetsRouter.createCaller({
			db,
			isAuthenticated: true,
		} as unknown as HostServiceContext);
	return { sqlite, db, caller };
}

function preset() {
	return {
		id: randomUUID(),
		name: "Dev 中文 🙂",
		description: "Original script",
		cwd: "./apps/web",
		commands: ["printf '%s\\n' 'hello world'", "bun run dev"],
		projectIds: ["project-a"],
		pinnedToBar: false,
		useAsWorkspaceRun: true,
		applyOnWorkspaceCreated: false,
		applyOnNewTab: true,
		executionMode: "new-tab-split-pane" as const,
		tabOrder: 0,
		createdAt: new Date(0),
	};
}

test("catalog reads are read-only and initialization preserves the original preset fields", async () => {
	const f = fixture();
	const api = f.caller();
	const before = await api.catalogWithRevisionV1();
	expect(before.initialized).toBe(false);
	expect(before.presets).toEqual([]);
	expect(
		f.sqlite.query("SELECT count(*) AS n FROM terminal_preset_catalog").get(),
	).toEqual({ n: 0 });
	const row = preset();
	const saved = await api.applyCatalogChangeV1({
		expectedRevision: before.revision,
		change: { kind: "initialize", presets: [row] },
	});
	expect(saved.initialized).toBe(true);
	expect(saved.presets).toEqual([row]);
	expect(saved.revision).not.toBe(before.revision);
	expect(await f.caller().catalogWithRevisionV1()).toEqual(saved);
});

test("stale additions and edits cannot overwrite the latest catalog", async () => {
	const f = fixture();
	const api = f.caller();
	const row = preset();
	const initial = await api.catalogWithRevisionV1();
	const seeded = await api.applyCatalogChangeV1({
		expectedRevision: initial.revision,
		change: { kind: "initialize", presets: [row] },
	});
	const changed = await api.applyCatalogChangeV1({
		expectedRevision: seeded.revision,
		change: {
			kind: "update",
			id: row.id,
			patch: { name: "Other client", commands: [] },
		},
	});
	await expect(
		api.applyCatalogChangeV1({
			expectedRevision: seeded.revision,
			change: { kind: "update", id: row.id, patch: { name: "Stale" } },
		}),
	).rejects.toMatchObject({ code: "CONFLICT" });
	await expect(
		api.applyCatalogChangeV1({
			expectedRevision: seeded.revision,
			change: { kind: "add", preset: preset() },
		}),
	).rejects.toMatchObject({ code: "CONFLICT" });
	expect(await api.catalogWithRevisionV1()).toEqual(changed);
});

test("remove-all remains intentionally empty and cannot be initialized again", async () => {
	const f = fixture();
	const api = f.caller();
	const row = preset();
	const initial = await api.catalogWithRevisionV1();
	const seeded = await api.applyCatalogChangeV1({
		expectedRevision: initial.revision,
		change: { kind: "initialize", presets: [row] },
	});
	const empty = await api.applyCatalogChangeV1({
		expectedRevision: seeded.revision,
		change: { kind: "remove", id: row.id },
	});
	expect(empty.presets).toEqual([]);
	expect(empty.initialized).toBe(true);
	expect(await f.caller().catalogWithRevisionV1()).toEqual(empty);
	await expect(
		api.applyCatalogChangeV1({
			expectedRevision: empty.revision,
			change: { kind: "initialize", presets: [row] },
		}),
	).rejects.toMatchObject({ code: "CONFLICT" });
});

test("stable preset IDs prevent duplicate inserts after an uncertain response", async () => {
	const api = fixture().caller();
	const initial = await api.catalogWithRevisionV1();
	const initialized = await api.applyCatalogChangeV1({
		expectedRevision: initial.revision,
		change: { kind: "initialize", presets: [] },
	});
	const row = preset();
	const saved = await api.applyCatalogChangeV1({
		expectedRevision: initialized.revision,
		change: { kind: "add", preset: row },
	});
	await expect(
		api.applyCatalogChangeV1({
			expectedRevision: saved.revision,
			change: { kind: "add", preset: row },
		}),
	).rejects.toMatchObject({ code: "CONFLICT" });
	expect(await api.catalogWithRevisionV1()).toEqual(saved);
});

test("reorder validates the complete catalog atomically and stores contiguous positions", async () => {
	const api = fixture().caller();
	const a = preset();
	const b = { ...preset(), tabOrder: 1 };
	const initial = await api.catalogWithRevisionV1();
	const seeded = await api.applyCatalogChangeV1({
		expectedRevision: initial.revision,
		change: { kind: "initialize", presets: [a, b] },
	});
	for (const ids of [[a.id], [a.id, a.id], [a.id, randomUUID()]]) {
		await expect(
			api.applyCatalogChangeV1({
				expectedRevision: seeded.revision,
				change: { kind: "reorder", ids },
			}),
		).rejects.toMatchObject({ code: "BAD_REQUEST" });
		expect(await api.catalogWithRevisionV1()).toEqual(seeded);
	}
	const reordered = await api.applyCatalogChangeV1({
		expectedRevision: seeded.revision,
		change: { kind: "reorder", ids: [b.id, a.id] },
	});
	expect(reordered.presets).toEqual([
		{ ...b, tabOrder: 0 },
		{ ...a, tabOrder: 1 },
	]);
});

test("clear optional fields and commands without restoring old snapshots or flags", async () => {
	const api = fixture().caller();
	const row = preset();
	const initial = await api.catalogWithRevisionV1();
	const seeded = await api.applyCatalogChangeV1({
		expectedRevision: initial.revision,
		change: { kind: "initialize", presets: [row] },
	});
	const saved = await api.applyCatalogChangeV1({
		expectedRevision: seeded.revision,
		change: {
			kind: "update",
			id: row.id,
			patch: {
				description: "",
				commands: [],
				projectIds: null,
				cwd: "",
				applyOnNewTab: false,
				useAsWorkspaceRun: false,
				pinnedToBar: true,
				executionMode: "sequential",
			},
		},
	});
	expect(saved.presets[0]).toEqual({
		...row,
		description: "",
		commands: [],
		projectIds: null,
		cwd: "",
		applyOnNewTab: false,
		useAsWorkspaceRun: false,
		pinnedToBar: true,
		executionMode: "sequential",
	});
});

test("revisions reject ABA writes even when the original fields are restored", async () => {
	const api = fixture().caller();
	const row = preset();
	const initial = await api.catalogWithRevisionV1();
	const seeded = await api.applyCatalogChangeV1({
		expectedRevision: initial.revision,
		change: { kind: "initialize", presets: [row] },
	});
	const edited = await api.applyCatalogChangeV1({
		expectedRevision: seeded.revision,
		change: { kind: "update", id: row.id, patch: { name: "Temporary" } },
	});
	const restored = await api.applyCatalogChangeV1({
		expectedRevision: edited.revision,
		change: { kind: "update", id: row.id, patch: { name: row.name } },
	});
	expect(restored.presets).toEqual(seeded.presets);
	expect(restored.revision).not.toBe(seeded.revision);
	await expect(
		api.applyCatalogChangeV1({
			expectedRevision: seeded.revision,
			change: { kind: "remove", id: row.id },
		}),
	).rejects.toMatchObject({ code: "CONFLICT" });
});

test("missing IDs, oversized catalogs, and unknown fields leave storage unchanged", async () => {
	const api = fixture().caller();
	const initial = await api.catalogWithRevisionV1();
	const initialized = await api.applyCatalogChangeV1({
		expectedRevision: initial.revision,
		change: { kind: "initialize", presets: [] },
	});
	await expect(
		api.applyCatalogChangeV1({
			expectedRevision: initialized.revision,
			change: { kind: "remove", id: randomUUID() },
		}),
	).rejects.toMatchObject({ code: "NOT_FOUND" });
	await expect(
		api.applyCatalogChangeV1({
			expectedRevision: initialized.revision,
			change: {
				kind: "initialize",
				presets: Array.from({ length: 513 }, preset),
			},
		}),
	).rejects.toMatchObject({ code: "BAD_REQUEST" });
	await expect(
		api.applyCatalogChangeV1({
			expectedRevision: initialized.revision,
			change: {
				kind: "add",
				preset: { ...preset(), name: "a".repeat(4 * 1024 * 1024) },
			},
		}),
	).rejects.toMatchObject({ code: "BAD_REQUEST" });
	await expect(
		api.applyCatalogChangeV1({
			expectedRevision: initialized.revision,
			change: {
				kind: "add",
				preset: { ...preset(), organizationId: "forbidden" } as ReturnType<
					typeof preset
				>,
			},
		}),
	).rejects.toMatchObject({ code: "BAD_REQUEST" });
	expect(await api.catalogWithRevisionV1()).toEqual(initialized);
});

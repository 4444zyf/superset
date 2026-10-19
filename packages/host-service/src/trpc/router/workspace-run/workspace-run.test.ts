import { Database } from "bun:sqlite";
import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import * as schema from "../../../db/schema";
import {
	DirectOperationStore,
	type OperationDatabase,
} from "../../../direct/operations";
import type { HostServiceContext } from "../../../types";
import { terminalPresetsRouter } from "../settings/terminal-presets";
import { workspaceRunRouter } from "./workspace-run";

const cleanup: (() => void)[] = [];
afterEach(() => {
	for (const close of cleanup.splice(0)) close();
});
const workspaceId = "2aa6044d-367f-45fa-b652-d78414a72bf5";
function fixture() {
	const root = mkdtempSync(join(tmpdir(), "workspace-run-router-"));
	const sqlite = new Database(":memory:"),
		ops = new Database(":memory:");
	const db = drizzle(sqlite, { schema });
	migrate(db, {
		migrationsFolder: resolve(import.meta.dir, "../../../../drizzle"),
	});
	const repoPath = join(root, "repo"),
		worktreePath = join(root, "worktree");
	for (const directory of [repoPath, worktreePath])
		mkdirSync(join(directory, ".superset"), { recursive: true });
	const projectId = crypto.randomUUID();
	db.insert(schema.projects).values({ id: projectId, repoPath }).run();
	db.insert(schema.workspaces)
		.values({ id: workspaceId, projectId, worktreePath, branch: "main" })
		.run();
	const ctx = {
		db,
		isAuthenticated: true,
		direct: {},
		directOperations: new DirectOperationStore(
			ops as unknown as OperationDatabase,
			"instance",
		),
		runtime: {},
	} as unknown as HostServiceContext;
	cleanup.push(() => {
		sqlite.close();
		ops.close();
		rmSync(root, { recursive: true, force: true });
	});
	return {
		caller: workspaceRunRouter.createCaller(ctx),
		presets: terminalPresetsRouter.createCaller(ctx),
		db,
		projectId,
		root,
		repoPath,
		worktreePath,
	};
}

test("run preview reuses original worktree-over-project resolution and rejects a stale definition before launch", async () => {
	const f = fixture();
	writeFileSync(
		join(f.repoPath, ".superset/config.json"),
		JSON.stringify({ run: ["echo project"] }),
	);
	writeFileSync(
		join(f.worktreePath, ".superset/config.json"),
		JSON.stringify({ run: ["echo worktree"], cwd: "apps/web" }),
	);
	const preview = await f.caller.getStateV1({ workspaceId });
	expect(preview.definition?.commands).toEqual(["echo worktree"]);
	expect(preview.definition?.cwd).toBe("apps/web");
	expect(preview.run).toBeNull();
	writeFileSync(
		join(f.worktreePath, ".superset/config.json"),
		JSON.stringify({ run: ["echo changed"] }),
	);
	await expect(
		f.caller.startV1({
			workspaceId,
			operationId: crypto.randomUUID(),
			definitionVersion: preview.definitionVersion!,
		}),
	).rejects.toMatchObject({ code: "CONFLICT" });
});

async function scriptCatalog(
	f: ReturnType<typeof fixture>,
	rows: Array<Record<string, unknown>>,
) {
	const before = await f.presets.catalogWithRevisionV1();
	return f.presets.applyCatalogChangeV1({
		expectedRevision: before.revision,
		change: {
			kind: "initialize",
			presets: rows.map((row, tabOrder) => ({
				id: crypto.randomUUID(),
				name: "Run script",
				commands: ["echo preset"],
				cwd: "",
				projectIds: null,
				executionMode: "split-pane" as const,
				createdAt: new Date(),
				tabOrder,
				useAsWorkspaceRun: true,
				...row,
			})),
		},
	});
}

test("V2 Run reuses project script priority without changing the V1 configuration contract", async () => {
	const f = fixture();
	writeFileSync(
		join(f.repoPath, ".superset/config.json"),
		JSON.stringify({ run: ["echo config"] }),
	);
	await scriptCatalog(f, [
		{ commands: ["echo global"] },
		{
			commands: [" ", "echo targeted"],
			projectIds: [f.projectId],
			pinnedToBar: false,
			cwd: " 脚本 目录 ",
		},
	]);
	const next = await f.caller.getStateV2({ workspaceId });
	expect(next.definition).toMatchObject({
		source: "terminal-preset",
		commands: ["echo targeted"],
		cwd: "脚本 目录",
	});
	expect((await f.caller.getStateV1({ workspaceId })).definition).toMatchObject(
		{ source: "project-config", commands: ["echo config"] },
	);
});

test("V2 Run keeps project configuration ahead of global scripts and skips empty or unrelated project scripts", async () => {
	const f = fixture();
	writeFileSync(
		join(f.repoPath, ".superset/config.json"),
		JSON.stringify({ run: ["echo config"] }),
	);
	await scriptCatalog(f, [
		{ commands: ["echo global"] },
		{ commands: ["echo other"], projectIds: [crypto.randomUUID()] },
		{ commands: ["  "], projectIds: [f.projectId] },
	]);
	expect((await f.caller.getStateV2({ workspaceId })).definition).toMatchObject(
		{ source: "project-config", commands: ["echo config"] },
	);
});

test("V2 Run supports project-less sessions with only global presets and does not initialize agent settings", async () => {
	const f = fixture();
	f.db.update(schema.workspaces).set({ projectId: null }).run();
	await scriptCatalog(f, [
		{ commands: ["echo project"], projectIds: [f.projectId] },
		{ commands: ["echo session"] },
	]);
	const next = await f.caller.getStateV2({ workspaceId });
	expect(next.projectId).toBeNull();
	expect(next.definition).toMatchObject({
		source: "terminal-preset",
		commands: ["echo session"],
	});
	expect(f.db.select().from(schema.hostAgentConfigs).all()).toEqual([]);
	expect((await f.caller.getStateV1({ workspaceId })).definition).toBeNull();
});

test("V2 Run rejects a script changed after preview before creating any terminal", async () => {
	const f = fixture();
	const catalog = await scriptCatalog(f, [{}]);
	const preview = await f.caller.getStateV2({ workspaceId });
	await f.presets.applyCatalogChangeV1({
		expectedRevision: catalog.revision,
		change: {
			kind: "update",
			id: catalog.presets[0]!.id,
			patch: { commands: ["echo changed"] },
		},
	});
	await expect(
		f.caller.startV2({
			workspaceId,
			operationId: crypto.randomUUID(),
			definitionVersion: preview.definitionVersion!,
		}),
	).rejects.toMatchObject({ code: "CONFLICT" });
});

test("V2 Run reads an explicitly empty catalog without creating defaults or replacing its revision", async () => {
	const f = fixture();
	const catalog = await scriptCatalog(f, []);
	expect((await f.caller.getStateV2({ workspaceId })).definition).toBeNull();
	expect(await f.presets.catalogWithRevisionV1()).toEqual(catalog);
	expect(f.db.select().from(schema.hostAgentConfigs).all()).toEqual([]);
});

test("V2 Run uses original linked agent command quoting and refuses a changed linked command", async () => {
	const f = fixture(),
		agentId = crypto.randomUUID();
	f.db
		.insert(schema.hostAgentConfigs)
		.values({
			id: agentId,
			presetId: "custom",
			label: "Linked",
			command: "/bin/echo",
			argsJson: JSON.stringify(["中文 space", "it's"]),
			envJson: JSON.stringify({ RUN_LABEL: "a b" }),
			promptTransport: "argv",
			displayOrder: 0,
		})
		.run();
	await scriptCatalog(f, [{ agentId, commands: ["echo stale fallback"] }]);
	const preview = await f.caller.getStateV2({ workspaceId });
	expect(preview.definition?.commands).toEqual([
		"RUN_LABEL='a b' /bin/echo '中文 space' 'it'\\''s'",
	]);
	f.db
		.update(schema.hostAgentConfigs)
		.set({ argsJson: JSON.stringify(["changed"]) })
		.run();
	await expect(
		f.caller.startV2({
			workspaceId,
			operationId: crypto.randomUUID(),
			definitionVersion: preview.definitionVersion!,
		}),
	).rejects.toMatchObject({ code: "CONFLICT" });
});

test("V2 Run keeps a targeted script usable when overridden project configuration is invalid", async () => {
	const f = fixture();
	writeFileSync(
		join(f.repoPath, ".superset/config.json"),
		JSON.stringify({ run: ["x".repeat(128 * 1024 + 1)] }),
	);
	await scriptCatalog(f, [
		{ projectIds: [f.projectId], commands: ["echo targeted"] },
	]);
	const next = await f.caller.getStateV2({ workspaceId });
	expect(next.definitionError).toBeNull();
	expect(next.definition?.commands).toEqual(["echo targeted"]);
	expect(
		(await f.caller.getStateV1({ workspaceId })).definitionError,
	).toContain("128 KiB");
});

test("invalid oversized run configuration does not make run status unavailable", async () => {
	const f = fixture();
	writeFileSync(
		join(f.repoPath, ".superset/config.json"),
		JSON.stringify({ run: ["x".repeat(128 * 1024 + 1)] }),
	);
	const preview = await f.caller.getStateV1({ workspaceId });
	expect(preview.definition).toBeNull();
	expect(preview.definitionError).toContain("128 KiB");
	expect(preview.run).toBeNull();
});

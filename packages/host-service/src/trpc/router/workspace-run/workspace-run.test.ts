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

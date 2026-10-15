import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, renameSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { hostSettings, projects, workspaces } from "../../src/db/schema";
import { configureManagedWorkspaceHome } from "../../src/direct/managed-paths";
import { createProjectScenario } from "../helpers/scenarios";

test("same-named projects in separate direct namespaces cannot share a worktree directory", async () => {
	const machineHome = mkdtempSync(join(tmpdir(), "remix-project-isolation-"));
	configureManagedWorkspaceHome(
		join(machineHome, ".private-backend"),
		machineHome,
	);
	const first = await createProjectScenario({
		hostOptions: { runtimeMode: "direct" },
	});
	const second = await createProjectScenario({
		hostOptions: { runtimeMode: "direct" },
	});
	try {
		const paths: string[] = [];
		for (const scenario of [first, second]) {
			scenario.host.db
				.update(projects)
				.set({ name: "Example" })
				.where(eq(projects.id, scenario.projectId))
				.run();
			const result = await scenario.host.trpc.workspaces.create.mutate({
				projectId: scenario.projectId,
				name: "Feature",
				branch: "feature/same",
				skipBranchPrefix: true,
			});
			const workspace = scenario.host.db
				.select()
				.from(workspaces)
				.where(eq(workspaces.id, result.workspace.id))
				.get();
			paths.push(workspace!.worktreePath);
			expect(existsSync(workspace!.worktreePath)).toBe(true);
		}
		expect(paths[0]).not.toBe(paths[1]);
	} finally {
		await second.dispose();
		await first.dispose();
		configureManagedWorkspaceHome(null);
		rmSync(machineHome, { recursive: true, force: true });
	}
});

test("direct worktrees create and clean up under the machine-wide Remix folder despite stored overrides", async () => {
	const machineHome = mkdtempSync(join(tmpdir(), "remix-machine-home-"));
	configureManagedWorkspaceHome(
		join(machineHome, ".private-backend"),
		machineHome,
	);
	const scenario = await createProjectScenario({
		hostOptions: { runtimeMode: "direct" },
	});
	try {
		const { host, projectId, repo } = scenario;
		host.db
			.insert(hostSettings)
			.values({ id: 1, worktreeBaseDir: join(machineHome, "old-host") })
			.run();
		host.db
			.update(projects)
			.set({
				name: "My Project",
				worktreeBaseDir: join(machineHome, "old-agent"),
			})
			.where(eq(projects.id, projectId))
			.run();
		expect(await host.trpc.settings.worktreeLocation.get.query()).toEqual({
			worktreeBaseDir: null,
			defaultWorktreeBaseDir: join(machineHome, "Superset Remix/worktrees"),
		});
		const created = await host.trpc.workspaces.create.mutate({
			projectId,
			name: "Central",
			branch: "feature/central",
			skipBranchPrefix: true,
		});
		const workspace = host.db
			.select()
			.from(workspaces)
			.where(eq(workspaces.id, created.workspace.id))
			.get();
		const expectedPath = join(
			machineHome,
			`Superset Remix/worktrees/My Project-${projectId}/feature/central`,
		);
		expect(workspace?.worktreePath).toBe(expectedPath);
		expect(existsSync(expectedPath)).toBe(true);
		expect(await repo.git.raw(["worktree", "list", "--porcelain"])).toContain(
			expectedPath,
		);
		await host.trpc.project.update.mutate({
			projectId,
			name: "Renamed Project",
		});
		renameSync(repo.repoPath, join(machineHome, "moved-repo"));
		await host.trpc.workspace.delete.mutate({ id: created.workspace.id });
		expect(existsSync(expectedPath)).toBe(false);
		expect(existsSync(join(machineHome, "old-agent"))).toBe(false);
		expect(host.apiCalls).toEqual([]);
	} finally {
		await scenario.dispose();
		configureManagedWorkspaceHome(null);
		rmSync(machineHome, { recursive: true, force: true });
	}
});

test("direct location settings cannot redirect worktrees to an Agent folder", async () => {
	const machineHome = mkdtempSync(join(tmpdir(), "remix-machine-settings-"));
	configureManagedWorkspaceHome(
		join(machineHome, ".private-backend"),
		machineHome,
	);
	const scenario = await createProjectScenario({
		hostOptions: { runtimeMode: "direct" },
	});
	try {
		const { host, projectId } = scenario;
		await expect(
			host.trpc.settings.worktreeLocation.set.mutate({
				path: join(machineHome, ".claude/worktrees"),
			}),
		).rejects.toMatchObject({ data: { code: "BAD_REQUEST" } });
		await expect(
			host.trpc.project.setWorktreeBaseDir.mutate({
				projectId,
				path: join(machineHome, ".codex/worktrees"),
			}),
		).rejects.toMatchObject({ data: { code: "BAD_REQUEST" } });
		expect(
			await host.trpc.project.setWorktreeBaseDir.mutate({
				projectId,
				path: null,
			}),
		).toEqual({ id: projectId, worktreeBaseDir: null });
		expect(
			await host.trpc.settings.worktreeLocation.set.mutate({
				path: join(machineHome, "Superset Remix/worktrees"),
			}),
		).toEqual({
			worktreeBaseDir: null,
			defaultWorktreeBaseDir: join(machineHome, "Superset Remix/worktrees"),
		});
	} finally {
		await scenario.dispose();
		configureManagedWorkspaceHome(null);
		rmSync(machineHome, { recursive: true, force: true });
	}
});

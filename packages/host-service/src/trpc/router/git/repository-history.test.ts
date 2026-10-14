import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { simpleGit } from "simple-git";
import type { HostServiceContext } from "../../../types";
import { gitRouter } from "./git";

test("repository history pages include base commits and retain a fixed HEAD when new commits arrive", async () => {
	const directory = mkdtempSync(join(tmpdir(), "superset-repository-history-"));
	try {
		const git = simpleGit(directory);
		await git.init();
		await git.raw(["config", "user.name", "History Author"]);
		await git.raw(["config", "user.email", "history@example.invalid"]);
		await git.raw(["symbolic-ref", "HEAD", "refs/heads/main"]);
		for (const message of ["Alpha\twith tab", "Beta", "Gamma"])
			await git.raw([
				"-c",
				"commit.gpgsign=false",
				"commit",
				"--allow-empty",
				"-m",
				message,
			]);
		const ctx = {
			isAuthenticated: true,
			db: {
				query: {
					workspaces: {
						findFirst: () => ({ sync: () => ({ worktreePath: directory }) }),
					},
				},
			},
			git: async (path: string) => simpleGit(path),
			credentials: {
				getCredentials: async () => ({ env: {} }),
				getToken: async () => null,
			},
		} as unknown as HostServiceContext;
		const caller = gitRouter.createCaller(ctx);
		const first = await caller.listRepositoryCommitsV1({
			workspaceId: "workspace",
			limit: 2,
		});
		expect(first.commits.map((commit) => commit.message)).toEqual([
			"Gamma",
			"Beta",
		]);
		expect(first.nextCursor).not.toBeNull();
		await git.raw([
			"-c",
			"commit.gpgsign=false",
			"commit",
			"--allow-empty",
			"-m",
			"Delta",
		]);
		const second = await caller.listRepositoryCommitsV1({
			workspaceId: "workspace",
			limit: 2,
			cursor: first.nextCursor!,
		});
		expect(second.head).toBe(first.head);
		expect(second.commits.map((commit) => commit.message)).toEqual([
			"Alpha\twith tab",
		]);
		expect(second.nextCursor).toBeNull();
		expect(
			(
				await caller.listCommits({
					workspaceId: "workspace",
					baseBranch: "main",
				})
			).commits,
		).toEqual([]);
		await expect(
			caller.listRepositoryCommitsV1({ workspaceId: "workspace", limit: 0 }),
		).rejects.toMatchObject({ code: "BAD_REQUEST" });
		await expect(
			caller.listRepositoryCommitsV1({
				workspaceId: "workspace",
				cursor: { head: "--all", skip: 0 },
			}),
		).rejects.toMatchObject({ code: "BAD_REQUEST" });
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
});

test("an unborn repository is empty but a corrupt HEAD is reported instead of hidden", async () => {
	const { writeFileSync } = await import("node:fs");
	const directory = mkdtempSync(join(tmpdir(), "superset-empty-history-"));
	try {
		await simpleGit(directory).init();
		const ctx = {
			isAuthenticated: true,
			db: {
				query: {
					workspaces: {
						findFirst: () => ({ sync: () => ({ worktreePath: directory }) }),
					},
				},
			},
			credentials: {
				getCredentials: async () => ({ env: {} }),
				getToken: async () => null,
			},
		} as unknown as HostServiceContext;
		const caller = gitRouter.createCaller(ctx);
		expect(
			await caller.listRepositoryCommitsV1({ workspaceId: "workspace" }),
		).toEqual({ head: null, commits: [], nextCursor: null });
		writeFileSync(join(directory, ".git", "HEAD"), `${"0".repeat(40)}\n`);
		let failure: unknown;
		try {
			await caller.listRepositoryCommitsV1({ workspaceId: "workspace" });
		} catch (error) {
			failure = error;
		}
		expect(failure).toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
});

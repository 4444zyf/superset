import { expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import {
	createBasicScenario,
	createFeatureWorktreeScenario,
} from "../helpers/scenarios";

test("a direct worktree compares its committed files with a local base without an origin remote", async () => {
	const scenario = await createFeatureWorktreeScenario({
		hostOptions: { runtimeMode: "direct" },
	});
	try {
		const {
			host,
			repo,
			worktreePath,
			featureWorkspaceId: workspaceId,
		} = scenario;
		writeFileSync(join(worktreePath, "local-feature.txt"), "local feature\n");
		await repo.git.cwd(worktreePath).add("local-feature.txt");
		await repo.git.commit("Local feature");
		const status = await host.trpc.git.getStatus.query({
			workspaceId,
			baseBranch: "main",
		});
		expect(status.againstBase.map((f) => f.path)).toEqual([
			"local-feature.txt",
		]);
		const diff = await host.trpc.git.getDiff.query({
			workspaceId,
			baseBranch: "main",
			category: "against-base",
			path: "local-feature.txt",
		});
		expect(diff.oldFile.contents).toBe("");
		expect(diff.newFile.contents).toBe("local feature\n");
		const [bulk, patch, side] = await Promise.all([
			host.trpc.git.getDiffBulk.query({
				workspaceId,
				baseBranch: "main",
				category: "against-base",
				paths: ["local-feature.txt"],
			}),
			host.trpc.git.getDiffPatch.query({
				workspaceId,
				baseBranch: "main",
				category: "against-base",
				paths: ["local-feature.txt"],
			}),
			host.trpc.git.readDiffSideFile.query({
				workspaceId,
				baseBranch: "main",
				category: "against-base",
				path: "local-feature.txt",
				side: "new",
			}),
		]);
		expect(bulk.diffs[0]?.newFile.contents).toBe("local feature\n");
		expect(patch.patch).toContain("+local feature");
		expect(side).toMatchObject({
			kind: "bytes",
			content: Buffer.from("local feature\n").toString("base64"),
		});
	} finally {
		await scenario.dispose();
	}
});

test("a durable direct commit preserves unstaged edits and reuses the same receipt without another commit", async () => {
	const scenario = await createBasicScenario({
		hostOptions: { runtimeMode: "direct" },
	});
	const { host, repo, workspaceId } = scenario;
	try {
		writeFileSync(join(repo.repoPath, "selected.txt"), "selected");
		writeFileSync(join(repo.repoPath, "keep.txt"), "keep this unstaged");
		await host.trpc.git.stageFile.mutate({
			workspaceId,
			filePath: "selected.txt",
		});
		const operation = {
			operationId: "817e868f-f7b6-48f7-aa0d-e3099e2f62c6",
			procedure: "git.commit" as const,
			input: { workspaceId, message: "Selected changes", stageAll: false },
		};
		const first = await host.trpc.direct.execute.mutate(operation);
		const retry = await host.trpc.direct.execute.mutate(operation);
		expect(first).toMatchObject({
			status: "completed",
			result: { success: true },
		});
		expect(retry).toEqual(first);
		expect((await repo.git.log()).total).toBe(2);
		expect((await repo.git.status()).not_added).toContain("keep.txt");
		expect(
			await repo.git.raw(["show", "--format=", "--name-only", "HEAD"]),
		).toBe("selected.txt\n");
		expect(
			await host.trpc.direct.operationStatus.query({
				operationId: operation.operationId,
			}),
		).toEqual(first);
		expect(host.apiCalls).toEqual([]);
	} finally {
		await scenario.dispose();
	}
});

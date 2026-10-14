import { expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { createBasicScenario } from "../helpers/scenarios";

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

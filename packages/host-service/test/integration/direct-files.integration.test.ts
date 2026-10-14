import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createBasicScenario } from "../helpers/scenarios";

test("direct file operations use the workspace service, preserve conflicts, and never construct a cloud request", async () => {
	const scenario = await createBasicScenario({
		hostOptions: { runtimeMode: "direct" },
	});
	const { host, repo, workspaceId } = scenario;
	try {
		const source = join(repo.repoPath, "example.txt");
		const folder = join(repo.repoPath, "folder");
		const copied = join(folder, "copy.txt");
		const moved = join(folder, "moved.txt");
		expect(
			await host.trpc.filesystem.writeFile.mutate({
				workspaceId,
				absolutePath: source,
				content: "native file search example",
				options: { create: true, overwrite: false },
			}),
		).toMatchObject({ ok: true });
		expect(
			await host.trpc.filesystem.writeFile.mutate({
				workspaceId,
				absolutePath: source,
				content: "overwrite",
				options: { create: true, overwrite: false },
			}),
		).toEqual({ ok: false, reason: "exists" });
		await host.trpc.filesystem.createDirectory.mutate({
			workspaceId,
			absolutePath: folder,
			recursive: false,
		});
		await host.trpc.filesystem.copyPath.mutate({
			workspaceId,
			sourceAbsolutePath: source,
			destinationAbsolutePath: copied,
		});
		await host.trpc.filesystem.movePath.mutate({
			workspaceId,
			sourceAbsolutePath: copied,
			destinationAbsolutePath: moved,
		});
		expect(existsSync(copied)).toBe(false);
		expect(readFileSync(moved, "utf8")).toBe("native file search example");
		const results = await host.trpc.filesystem.searchContent.query({
			workspaceId,
			query: "native file search",
			limit: 100,
		});
		expect(results.matches.map((match) => match.absolutePath)).toContain(moved);
		await expect(
			host.trpc.filesystem.movePath.mutate({
				workspaceId,
				sourceAbsolutePath: moved,
				destinationAbsolutePath: source,
			}),
		).rejects.toMatchObject({ data: { code: "CONFLICT" } });
		expect(readFileSync(source, "utf8")).toBe("native file search example");
		await host.trpc.filesystem.deletePath.mutate({
			workspaceId,
			absolutePath: moved,
			permanent: true,
		});
		expect(existsSync(moved)).toBe(false);
		expect(host.apiCalls).toEqual([]);
	} finally {
		await scenario.dispose();
	}
});

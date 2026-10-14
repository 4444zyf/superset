import { expect, test } from "bun:test";
import { createBasicScenario } from "../helpers/scenarios";

test("Git identity is configured in the selected repository without changing other Git settings or using an account API", async () => {
	const scenario = await createBasicScenario({
		hostOptions: { runtimeMode: "direct" },
	});
	const { host, repo, workspaceId } = scenario;
	try {
		await repo.git.raw(["config", "--local", "fixture.keep", "original"]);
		expect(
			await host.trpc.git.getUserIdentityV1.query({ workspaceId }),
		).toMatchObject({
			name: "Test Runner",
			email: "test@superset.local",
			configured: true,
		});
		await host.trpc.git.setUserIdentityV1.mutate({
			workspaceId,
			name: "--Fixture Author",
			email: "fixture@example.invalid",
		});
		expect(
			await host.trpc.git.getUserIdentityV1.query({ workspaceId }),
		).toEqual({
			name: "--Fixture Author",
			email: "fixture@example.invalid",
			configured: true,
		});
		expect((await repo.git.getConfig("fixture.keep")).value).toBe("original");
		expect((await repo.git.getConfig("user.name", "local")).value).toBe(
			"--Fixture Author",
		);
		expect(host.apiCalls).toEqual([]);
	} finally {
		await scenario.dispose();
	}
});

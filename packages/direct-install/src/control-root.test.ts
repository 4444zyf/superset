import { expect, test } from "bun:test";
import { type RootLifecycleDriver, runLifecycle } from "./control-root";

function fixture() {
	const calls: string[] = [];
	const driver: RootLifecycleDriver = {
		user: async (command) => {
			calls.push(`uid:${command}`);
			return { action: "stop", status: "completed" };
		},
		startJob: () => {
			calls.push("root:start-job");
		},
		stopJob: () => {
			calls.push("root:stop-job");
		},
		removeJob: () => {
			calls.push("root:remove-job");
		},
	};
	return { driver, calls };
}
test("explicit stop persists the UID stop before removing the job and clears only owned PTY afterward", async () => {
	const f = fixture();
	await runLifecycle("stop", f.driver);
	expect(f.calls).toEqual(["uid:stop", "root:stop-job", "uid:stop-owned"]);
});
test("uninstall stops owned work and removes its job while retaining user data", async () => {
	const f = fixture();
	await runLifecycle("uninstall", f.driver);
	expect(f.calls).toEqual([
		"uid:stop",
		"root:stop-job",
		"uid:stop-owned",
		"root:remove-job",
	]);
});
test("start enables the namespace and starts its launchd job without issuing a stop", async () => {
	const f = fixture();
	await runLifecycle("start", f.driver);
	expect(f.calls).toEqual(["uid:start", "root:start-job"]);
});
test("stopped repair proves the host is stopped and updates only its launcher while leaving workload disabled", async () => {
	const f = fixture();
	f.driver.repairJob = () => {
		f.calls.push("root:repair-job");
	};
	await runLifecycle("repair", f.driver);
	expect(f.calls).toEqual([
		"uid:verify-stopped",
		"root:stop-job",
		"uid:stop-owned",
		"root:repair-job",
	]);
	expect(f.calls).not.toContain("uid:start");
});

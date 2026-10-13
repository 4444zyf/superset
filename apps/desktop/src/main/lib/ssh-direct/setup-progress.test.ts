import { expect, test } from "bun:test";
import type { DirectSetupSnapshot } from "../../../shared/direct-workstation";
import { SetupProgress } from "./setup-progress";

test("concurrent connect calls share a task and snapshots keep monotonic timings without exposing errors", async () => {
	let now = 100;
	let complete: (value: number) => void = () => {};
	const events: DirectSetupSnapshot[] = [];
	const jobs = new SetupProgress(
		(snapshot) => events.push(snapshot),
		() => now,
	);
	const first = jobs.run(
		"mac",
		() =>
			new Promise<number>((resolve) => {
				complete = resolve;
			}),
	);
	const second = jobs.run("mac", async () => 0);
	expect(first).toBe(second);
	await Promise.resolve();
	now = 120;
	jobs.phase("mac", "uploading");
	expect(jobs.get("mac")?.elapsedMs).toBe(20);
	complete(42);
	expect(await first).toBe(42);
	expect(events.at(-1)).toMatchObject({
		status: "completed",
		elapsedMs: 20,
		sequence: 3,
	});
	await expect(
		jobs.run("mac", async () => {
			throw new Error("private credential");
		}),
	).rejects.toThrow("private credential");
	expect(jobs.get("mac")?.generation).toBe(2);
	expect(JSON.stringify(events)).not.toContain("private credential");
});

test("finished task snapshots are bounded and a snapshot cannot mutate main process state", async () => {
	const jobs = new SetupProgress(
		() => {},
		() => 0,
	);
	for (let i = 0; i < 51; i++) await jobs.run(`mac-${i}`, async () => true);
	expect(jobs.get("mac-0")).toBeNull();
	const snapshot = jobs.get("mac-50");
	if (snapshot) snapshot.status = "failed";
	expect(jobs.get("mac-50")?.status).toBe("completed");
});

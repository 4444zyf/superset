import { expect, test } from "bun:test";
import {
	type ActivationRequestDriver,
	requestActivation,
} from "./control-actions";
import type { ServiceConfig } from "./control-runtime";

const config = {
	backendId: "11111111-1111-1111-1111-111111111111",
	namespaceId: "22222222-2222-2222-2222-222222222222",
	homeDir: "/Users/alice/.superset-direct",
	secretFile: "/secret",
	migrationsFolder: "/migrations",
	hostServicePath: "/host",
	allowedOrigins: [],
} satisfies ServiceConfig;
function driver(busy = false) {
	const calls: string[] = [];
	const driver: ActivationRequestDriver = {
		describe: async () => ({ instanceId: "old-instance", version: "1" }),
		beginDrain: async (ownerId, freeze) => {
			calls.push(freeze ? "freeze" : "drain");
			return {
				ownerId,
				frozen: freeze,
				mode: "draining",
				safeToRestart: !busy,
				activeChat: busy ? 1 : 0,
				queuedPrompts: 0,
				waitingApprovals: 0,
				activeCreateOperations: 0,
				activeBackgroundOperations: 0,
			};
		},
		endDrain: async () => {
			calls.push("end-drain");
		},
		writeJournal: () => {
			calls.push("journal");
		},
		shutdown: async () => {
			calls.push("shutdown-preserve-pty");
		},
	};
	return { calls, driver };
}
test("busy activation releases its drain and cancels its durable intent without stopping the current host", async () => {
	const f = driver(true);
	expect(
		(await requestActivation(config, config, "new", "2", f.driver)).status,
	).toBe("deferred");
	expect(f.calls).toEqual(["journal", "drain", "end-drain", "journal"]);
});
test("activation persists intent before draining and recovery ownership before requesting a PTY-preserving shutdown", async () => {
	const f = driver();
	expect(
		(await requestActivation(config, config, "new", "2", f.driver)).status,
	).toBe("completed");
	expect(f.calls).toEqual([
		"journal",
		"drain",
		"freeze",
		"journal",
		"shutdown-preserve-pty",
	]);
});
test("freeze rejection cannot leave a quiet namespace draining forever", async () => {
	const f = driver();
	const begin = f.driver.beginDrain;
	f.driver.beginDrain = async (owner, freeze) => {
		if (freeze) throw new Error("work raced freeze");
		return begin(owner, freeze);
	};
	await expect(
		requestActivation(config, config, "new", "2", f.driver),
	).rejects.toThrow("raced");
	expect(f.calls).toEqual(["journal", "drain", "end-drain", "journal"]);
});

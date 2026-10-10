import { expect, test } from "bun:test";
import {
	assertSafeRestart,
	compatibleRelease,
	controlRemoteBackend,
} from "./lifecycle";

test("activation rejects active, queued or approval-waiting work even if a stale readiness flag is true", () => {
	for (const field of [
		"activeChat",
		"queuedPrompts",
		"waitingApprovals",
		"activeCreateOperations",
	]) {
		expect(() =>
			assertSafeRestart({ mode: "draining", safeToRestart: true, [field]: 1 }),
		).toThrow("active");
	}
});

test("automatic activation requires unchanged migration files and protocol/schema compatibility", () => {
	const current = {
		protocolVersion: 1,
		schemaVersion: 1,
		nodeAbi: 127,
		target: "darwin-arm64",
		files: [{ path: "share/migrations/0001.sql", sha256: "same" }],
	};
	const candidate = {
		...current,
		files: [
			...current.files,
			{ path: "lib/host-service-direct.js", sha256: "changed" },
		],
	};
	expect(compatibleRelease(current, candidate)).toBe(true);
	expect(compatibleRelease(current, { ...candidate, nodeAbi: 137 })).toBe(
		false,
	);
	expect(
		compatibleRelease(current, { ...candidate, target: "darwin-x64" }),
	).toBe(false);
	expect(compatibleRelease(current, { ...candidate, schemaVersion: 2 })).toBe(
		false,
	);
	expect(
		compatibleRelease(current, {
			...candidate,
			files: [{ path: "share/migrations/0002.sql", sha256: "new" }],
		}),
	).toBe(false);
});

test("lifecycle control requires a pinned release trust root before making any SSH command", async () => {
	let calls = 0;
	await expect(
		controlRemoteBackend({
			transport: {
				exec: async () => {
					calls++;
					return { stdout: "", stderr: "", exitCode: 0 };
				},
				upload: async () => {},
			},
			trustedKeys: {},
			action: "stop",
		}),
	).rejects.toThrow("trusted");
	expect(calls).toBe(0);
});
test("maintenance readiness fails closed when a released host omits activity counters", () => {
	expect(() =>
		assertSafeRestart({ mode: "draining", safeToRestart: true }),
	).toThrow("active");
});

import { expect, test } from "bun:test";
import { monitorDirectChild, superviseDirectBackend } from "./supervisor";

test("an unexpected host-service exit restarts on B without waiting for a desktop connection", async () => {
	let starts = 0;
	const controller = new AbortController();
	await superviseDirectBackend({
		signal: controller.signal,
		isDisabled: () => false,
		spawnBackend: async () => {
			starts++;
			if (starts === 2) controller.abort();
			return { exitCode: 1, signal: null };
		},
		waitForRetry: async () => {},
	});
	expect(starts).toBe(2);
});

test("a persistent stop prevents launchd from resurrecting an explicitly stopped backend", async () => {
	let starts = 0;
	await superviseDirectBackend({
		signal: new AbortController().signal,
		isDisabled: () => true,
		spawnBackend: async () => {
			starts++;
			return { exitCode: 0, signal: null };
		},
		waitForRetry: async () => {},
	});
	expect(starts).toBe(0);
});

test("activation preparation finishes before a candidate may start", async () => {
	const calls: string[] = [];
	const controller = new AbortController();
	await superviseDirectBackend({
		signal: controller.signal,
		isDisabled: () => false,
		beforeStart: async () => {
			calls.push("prepared");
		},
		spawnBackend: async () => {
			calls.push("spawn");
			controller.abort();
			return { exitCode: 0, signal: null };
		},
		waitForRetry: async () => {},
	});
	expect(calls).toEqual(["prepared", "spawn"]);
});

test("a failed recovery blocks startup until durable recovery succeeds", async () => {
	const calls: string[] = [];
	const controller = new AbortController();
	let attempts = 0;
	await superviseDirectBackend({
		signal: controller.signal,
		isDisabled: () => false,
		beforeStart: async () => {
			calls.push("recovery");
			if (attempts++ === 0) throw new Error("Injected backup failure");
		},
		spawnBackend: async () => {
			calls.push("spawn");
			controller.abort();
			return { exitCode: 0, signal: null };
		},
		waitForRetry: async () => {
			calls.push("retry");
		},
	});
	expect(calls).toEqual(["recovery", "retry", "recovery", "spawn"]);
});

test("rollback waits for the owned host to exit and leaves terminal ownership outside the child monitor", async () => {
	let exit!: (value: { exitCode: number; signal: null }) => void;
	const exited = new Promise<{ exitCode: number; signal: null }>((resolve) => {
		exit = resolve;
	});
	const calls: string[] = [];
	await monitorDirectChild(
		{
			exited,
			terminate: () => {
				calls.push("terminate-host");
				exit({ exitCode: 0, signal: null });
			},
		},
		async ({ stopCurrent }) => {
			await stopCurrent();
			calls.push("rollback");
		},
	);
	expect(calls).toEqual(["terminate-host", "rollback"]);
});

test("a failed commit acknowledgement keeps the owned host alive until its actual exit", async () => {
	let exit!: (value: { exitCode: number; signal: null }) => void;
	let terminate = 0;
	let finalizations = 0;
	const exited = new Promise<{ exitCode: number; signal: null }>((resolve) => {
		exit = resolve;
	});
	const running = monitorDirectChild(
		{
			exited,
			terminate: () => {
				terminate++;
			},
		},
		async () => {
			if (finalizations++ === 0) throw new Error("Commit acknowledgement lost");
			exit({ exitCode: 0, signal: null });
		},
		{ waitForTick: async () => {}, onFault: () => {} },
	);
	try {
		for (let step = 0; step < 10; step++) await Promise.resolve();
		expect(terminate).toBe(0);
		expect(finalizations).toBe(2);
	} finally {
		exit({ exitCode: 0, signal: null });
		await running.catch(() => {});
	}
});

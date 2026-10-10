import { expect, test } from "bun:test";
import type { DirectDescriptor } from "../../../shared/direct-workstation";
import { AutomaticReconnect } from "./automatic-reconnect";

class FakeClock {
	tasks = new Map<number, { delay: number; run: () => Promise<void> }>();
	id = 0;
	set = (run: () => Promise<void>, delay: number) => {
		const id = ++this.id;
		this.tasks.set(id, { run, delay });
		return id;
	};
	clear = (id: unknown) => this.tasks.delete(id as number);
	async next() {
		const entry = this.tasks.entries().next().value;
		if (!entry) throw new Error("No scheduled reconnect task");
		const [id, task] = entry;
		this.tasks.delete(id);
		await task.run();
		return task.delay;
	}
}

const descriptor: DirectDescriptor = {
	connectionId: "mini",
	generation: 1,
	backendId: "backend",
	namespaceId: "namespace",
	instanceId: "instance",
};

function fixture(connect?: () => Promise<DirectDescriptor>) {
	const clock = new FakeClock();
	let status = { state: "ready", generation: 1 };
	let calls = 0;
	const events: unknown[] = [];
	const retries = new AutomaticReconnect({
		clock,
		getStatus: () => status,
		connect: async () => {
			calls += 1;
			if (connect) return connect();
			status = { state: "ready", generation: status.generation + 1 };
			return { ...descriptor, generation: status.generation };
		},
		notify: (event) => events.push(event),
	});
	return {
		retries,
		clock,
		events,
		calls: () => calls,
		drop: () => {
			status = { state: "disconnected", generation: status.generation + 1 };
		},
	};
}

test("a network drop reconnects the same backend with a new generation", async () => {
	const f = fixture();
	f.retries.arm(descriptor, "ssh");
	f.drop();
	await f.clock.next();
	expect(f.calls()).toBe(0);
	expect(await f.clock.next()).toBe(1000);
	expect(f.calls()).toBe(1);
	expect(f.events).toEqual([
		{
			kind: "reconnecting",
			connectionId: "mini",
			previousGeneration: 1,
			attempt: 1,
		},
		{
			kind: "connected",
			connectionId: "mini",
			previousGeneration: 1,
			descriptor: { ...descriptor, generation: 3 },
		},
	]);
	f.retries.dispose();
	expect(f.clock.tasks.size).toBe(0);
});

test("only three transport retries run with bounded backoff", async () => {
	const f = fixture(async () => {
		throw Object.assign(new Error("Network unavailable"), { retryable: true });
	});
	f.retries.arm(descriptor, "ssh");
	f.drop();
	await f.clock.next();
	const delays = [
		await f.clock.next(),
		await f.clock.next(),
		await f.clock.next(),
	];
	expect(delays).toEqual([1000, 2000, 4000]);
	expect(f.calls()).toBe(3);
	expect(f.clock.tasks.size).toBe(0);
	expect(f.events.at(-1)).toMatchObject({
		kind: "blocked",
		connectionId: "mini",
		previousGeneration: 1,
		error: "Network unavailable",
	});
});

test("authentication, host key and unclassified failures stop after the first attempt", async () => {
	for (const message of [
		"Authentication failed",
		"Host key changed",
		"Unknown failure",
	]) {
		const f = fixture(async () => {
			throw new Error(message);
		});
		f.retries.arm(descriptor, "ssh");
		f.drop();
		await f.clock.next();
		await f.clock.next();
		expect(f.calls()).toBe(1);
		expect(f.clock.tasks.size).toBe(0);
		expect(f.events.at(-1)).toMatchObject({ kind: "blocked", error: message });
	}
});

test("explicit disconnect cancels a pending reconnect and ignores its late response", async () => {
	let finish!: (descriptor: DirectDescriptor) => void;
	const f = fixture(
		() =>
			new Promise((resolve) => {
				finish = resolve;
			}),
	);
	f.retries.arm(descriptor, "ssh");
	f.drop();
	await f.clock.next();
	const pending = f.clock.next();
	f.retries.disarm("mini");
	finish({ ...descriptor, generation: 3 });
	await pending;
	expect(f.events).toHaveLength(1);
	expect(f.clock.tasks.size).toBe(0);
	f.drop();
	expect(f.calls()).toBe(1);
});

test("a mismatched backend identity cannot be adopted as the previous session", async () => {
	const f = fixture(async () => ({
		...descriptor,
		generation: 3,
		backendId: "other",
	}));
	f.retries.arm(descriptor, "ssh");
	f.drop();
	await f.clock.next();
	await f.clock.next();
	expect(f.events.at(-1)).toMatchObject({ kind: "blocked" });
	expect(
		f.events.some((event) => (event as { kind: string }).kind === "connected"),
	).toBe(false);
	expect(f.clock.tasks.size).toBe(0);
});

test("a missing local endpoint cannot start a workload through automatic reconnect", async () => {
	const f = fixture(async () => {
		throw new Error("Automatic reconnect must never launch a local backend");
	});
	f.retries.arm(descriptor, "local");
	f.drop();
	if (f.clock.tasks.size) await f.clock.next();
	if (f.clock.tasks.size) await f.clock.next();
	expect(f.calls()).toBe(0);
	expect(f.events).toEqual([]);
	expect(f.clock.tasks.size).toBe(0);
});

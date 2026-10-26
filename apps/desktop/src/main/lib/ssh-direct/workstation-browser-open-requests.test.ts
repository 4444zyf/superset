import { expect, test } from "bun:test";
import {
	type WorkstationBrowserOpenEvent,
	WorkstationBrowserOpenRequests,
} from "./workstation-browser-open-requests";

function fixture() {
	let owner: { ownerId: number; ownerEpoch: number } | null = {
		ownerId: 7,
		ownerEpoch: 1,
	};
	const events: Array<{ ownerId: number; event: WorkstationBrowserOpenEvent }> =
			[],
		tasks = new Set<() => void>();
	let changes = 0;
	const requests = new WorkstationBrowserOpenRequests({
		getOwner: () => owner,
		changed: () => {
			changes++;
		},
		dispatch: (ownerId, event) => {
			events.push({ ownerId, event });
		},
		schedule: (_milliseconds, callback) => {
			tasks.add(callback);
			return () => {
				tasks.delete(callback);
			};
		},
	});
	const input = {
		descriptor: {
			connectionId: crypto.randomUUID(),
			generation: 1,
			backendId: "backend",
			namespaceId: "namespace",
			instanceId: "instance",
		},
		workspaceId: crypto.randomUUID(),
		projectId: crypto.randomUUID(),
		workspaceName: "Owned 工作区",
		url: "http://localhost:3000/中文",
		target: "current-tab" as const,
		show: false,
	};
	const ready = (subscriptionId = crypto.randomUUID()) => {
		const scope = requests.prepare(7, subscriptionId);
		expect(requests.confirmReady(7, { ...scope, subscriptionId })).toBe(true);
		return { ...scope, subscriptionId };
	};
	const result = {
		paneId: "created-pane",
		url: input.url,
		title: "Owned page",
	};
	return {
		requests,
		input,
		events,
		tasks,
		ready,
		result,
		changes: () => changes,
		owner: (value: typeof owner) => {
			owner = value;
		},
	};
}

test("only the current renderer can confirm its prepared subscription and scope", () => {
	const f = fixture();
	expect(f.requests.availability().ready).toBe(false);
	const lease = f.requests.prepare(7, "subscription");
	expect(
		f.requests.confirmReady(8, { ...lease, subscriptionId: "subscription" }),
	).toBe(false);
	expect(
		f.requests.confirmReady(7, {
			scopeId: crypto.randomUUID(),
			subscriptionId: "subscription",
		}),
	).toBe(false);
	expect(
		f.requests.confirmReady(7, { ...lease, subscriptionId: "subscription" }),
	).toBe(true);
	expect(f.requests.availability()).toMatchObject({
		scopeId: lease.scopeId,
		ready: true,
		accepting: true,
	});
	expect(f.events).toEqual([]);
});

test("pinning captures an immutable request without sending until its deferred executor runs", async () => {
	const f = fixture(),
		lease = f.ready();
	const original = structuredClone(f.input);
	const execute = f.requests.pin(f.input, lease.scopeId, () => true);
	expect(f.events).toEqual([]);
	expect(f.tasks.size).toBe(0);
	expect(f.requests.availability().accepting).toBe(false);
	f.input.descriptor.generation = 9;
	const pending = execute();
	const event = f.events[0]?.event;
	if (!event || event.type !== "open") throw Error("Missing owned open");
	expect(event.input).toEqual(original);
	expect(event.scopeId).toBe(lease.scopeId);
	expect(f.events[0]?.ownerId).toBe(7);
	expect(
		f.requests.complete(7, {
			id: event.id,
			...lease,
			ok: true,
			result: f.result,
		}),
	).toBe(true);
	expect(await pending).toEqual(f.result);
	expect(f.tasks.size).toBe(0);
	expect(f.requests.availability().accepting).toBe(true);
	await expect(execute()).rejects.toMatchObject({ kind: "unavailable" });
});

test("busy requests and stale view scopes cannot reserve another renderer effect", () => {
	const f = fixture(),
		lease = f.ready(),
		execute = f.requests.pin(f.input, lease.scopeId, () => true);
	expect(() => f.requests.pin(f.input, lease.scopeId, () => true)).toThrow(
		"pending",
	);
	execute.release?.();
	expect(f.events).toEqual([]);
	expect(f.requests.availability().accepting).toBe(true);
	expect(() =>
		f.requests.pin(f.input, crypto.randomUUID(), () => true),
	).toThrow("scope");
	expect(() => f.requests.pin(f.input, lease.scopeId, () => false)).toThrow(
		"unavailable",
	);
});

test("a scope change after pinning prevents dispatch and old release cannot clear a new reservation", async () => {
	const f = fixture(),
		first = f.ready(),
		old = f.requests.pin(f.input, first.scopeId, () => true);
	f.requests.invalidate();
	const second = f.ready();
	const current = f.requests.pin(f.input, second.scopeId, () => true);
	await expect(old()).rejects.toMatchObject({ kind: "unavailable" });
	old.release?.();
	expect(f.requests.availability().accepting).toBe(false);
	expect(f.events).toEqual([]);
	current.release?.();
	expect(f.requests.availability().accepting).toBe(true);
});

test("wrong senders, subscriptions, ids and old renderer epochs cannot complete the pending open", async () => {
	const f = fixture(),
		lease = f.ready(),
		execute = f.requests.pin(f.input, lease.scopeId, () => true),
		pending = execute();
	const event = f.events[0]?.event;
	if (!event || event.type !== "open") throw Error("Missing open");
	expect(
		f.requests.complete(8, {
			id: event.id,
			...lease,
			ok: true,
			result: f.result,
		}),
	).toBe(false);
	expect(
		f.requests.complete(7, {
			id: event.id,
			...lease,
			subscriptionId: "old",
			ok: true,
			result: f.result,
		}),
	).toBe(false);
	expect(
		f.requests.complete(7, {
			id: crypto.randomUUID(),
			...lease,
			ok: true,
			result: f.result,
		}),
	).toBe(false);
	f.owner({ ownerId: 7, ownerEpoch: 2 });
	expect(
		f.requests.complete(7, {
			id: event.id,
			...lease,
			ok: true,
			result: f.result,
		}),
	).toBe(false);
	const rejected = pending.catch((error) => error);
	f.requests.invalidate();
	expect(await rejected).toMatchObject({ kind: "unavailable" });
});

test("scope invalidation cancels an in-flight request and ignores its late acknowledgement", async () => {
	const f = fixture(),
		lease = f.ready(),
		pending = f.requests
			.pin(f.input, lease.scopeId, () => true)()
			.catch((error) => error);
	const event = f.events[0]?.event;
	if (!event || event.type !== "open") throw Error("Missing open");
	f.requests.invalidate();
	expect(await pending).toMatchObject({ kind: "unavailable" });
	expect(f.events.at(-1)?.event).toMatchObject({
		type: "cancel",
		id: event.id,
		scopeId: lease.scopeId,
	});
	expect(
		f.requests.complete(7, {
			id: event.id,
			...lease,
			ok: true,
			result: f.result,
		}),
	).toBe(false);
	expect(f.tasks.size).toBe(0);
	expect(f.requests.availability().ready).toBe(false);
});

test("a late cleanup from an older subscription cannot retire its replacement", () => {
	const f = fixture(),
		old = f.ready(),
		current = f.ready();
	f.requests.end(7, old.subscriptionId);
	expect(f.requests.availability()).toMatchObject({
		scopeId: current.scopeId,
		ready: true,
	});
	f.requests.end(7, current.subscriptionId);
	expect(f.requests.availability().ready).toBe(false);
});

test("a controlled timeout retires the open scope without leaving a timer or retry", async () => {
	const f = fixture(),
		lease = f.ready(),
		pending = f.requests
			.pin(f.input, lease.scopeId, () => true)()
			.catch((error) => error);
	const timeout = [...f.tasks][0];
	if (!timeout) throw Error("Missing controlled timer");
	timeout();
	expect(await pending).toMatchObject({ kind: "timeout" });
	expect(f.tasks.size).toBe(0);
	expect(f.requests.availability().ready).toBe(false);
	expect(f.events.filter((row) => row.event.type === "open")).toHaveLength(1);
	expect(f.events.filter((row) => row.event.type === "cancel")).toHaveLength(1);
});

test("releasing a dispatched request cancels only its own effect and does not replay", async () => {
	const f = fixture(),
		lease = f.ready(),
		execute = f.requests.pin(f.input, lease.scopeId, () => true),
		pending = execute().catch((error) => error);
	execute.release?.();
	expect(await pending).toMatchObject({ kind: "unavailable" });
	expect(f.events.map((row) => row.event.type)).toEqual(["open", "cancel"]);
	expect(f.tasks.size).toBe(0);
	expect(f.requests.availability().accepting).toBe(true);
});

test("a changed backend target cannot complete an otherwise current renderer request", async () => {
	const f = fixture(),
		lease = f.ready();
	let current = true;
	const execute = f.requests.pin(f.input, lease.scopeId, () => current),
		pending = execute().catch((error) => error);
	const event = f.events[0]?.event;
	if (!event || event.type !== "open") throw Error("Missing open");
	current = false;
	expect(
		f.requests.complete(7, {
			id: event.id,
			...lease,
			ok: true,
			result: f.result,
		}),
	).toBe(false);
	execute.release?.();
	expect(await pending).toMatchObject({ kind: "unavailable" });
	expect(f.tasks.size).toBe(0);
});

test("target refresh cancels a stale request without retiring the current renderer subscription", async () => {
	const f = fixture(),
		lease = f.ready();
	let current = true;
	const pending = f.requests
		.pin(f.input, lease.scopeId, () => current)()
		.catch((error) => error);
	current = false;
	f.requests.refresh();
	expect(await pending).toMatchObject({ kind: "unavailable" });
	expect(f.requests.availability()).toMatchObject({
		scopeId: lease.scopeId,
		ready: true,
		accepting: true,
	});
	expect(f.events.map((row) => row.event.type)).toEqual(["open", "cancel"]);
});

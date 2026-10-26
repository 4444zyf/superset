import { expect, test } from "bun:test";
import { DirectBrowserReadBridge } from "./browser-read-bridge";

const identity = {
	backendId: "backend",
	namespaceId: "namespace",
	instanceId: "instance",
};
const hello = {
	type: "hello",
	protocol: 1,
	...identity,
	features: ["readV1", "future-feature"],
};

function fixture() {
	const messages: Record<string, unknown>[] = [];
	const closed: { code: number; reason: string }[] = [];
	const tasks = new Map<number, () => void>();
	let next = 0,
		failSend = false;
	const supplied = { ...identity };
	const bridge = new DirectBrowserReadBridge(supplied, {
		schedule: (_milliseconds, callback) => {
			const id = ++next;
			tasks.set(id, callback);
			return () => {
				tasks.delete(id);
			};
		},
	});
	const transport = {
		send: (raw: string) => {
			if (failSend) throw Error("Owned transport failed");
			messages.push(JSON.parse(raw));
		},
		close: (code: number, reason: string) => {
			closed.push({ code, reason });
		},
	};
	const peer = bridge.attach(transport);
	return {
		bridge,
		peer,
		transport,
		supplied,
		messages,
		closed,
		tasks,
		ready: () => peer.receive(JSON.stringify(hello)),
		latestRequest: () => {
			const message = [...messages]
				.reverse()
				.find((row) => row.type === "request");
			if (!message || typeof message.id !== "string")
				throw Error("No owned request");
			return message;
		},
		reply: (id: unknown, value: unknown) =>
			peer.receive(JSON.stringify({ type: "result", id, ok: true, value })),
		failWrites: () => {
			failSend = true;
		},
	};
}

test("the read bridge becomes ready only after matching its captured backend identity and protocol", () => {
	const f = fixture();
	try {
		expect(f.bridge.isReady()).toBe(false);
		f.supplied.namespaceId = "changed-by-caller";
		f.ready();
		expect(f.bridge.isReady()).toBe(true);
		expect(f.messages).toEqual([
			{ type: "ready", protocol: 1, ...identity, features: ["readV1"] },
		]);
		expect(f.tasks.size).toBe(0);
	} finally {
		f.bridge.dispose();
	}
});

test("foreign backend identities, unsupported versions and missing read capability cannot attach", () => {
	for (const change of [
		{ backendId: "foreign" },
		{ namespaceId: "foreign" },
		{ instanceId: "foreign" },
		{ protocol: 2 },
		{ features: ["future-feature"] },
	]) {
		const f = fixture();
		try {
			f.peer.receive(JSON.stringify({ ...hello, ...change }));
			expect(f.bridge.isReady()).toBe(false);
			expect(f.closed).toHaveLength(1);
			expect(f.tasks.size).toBe(0);
		} finally {
			f.bridge.dispose();
		}
	}
});

test("a single peer owns readiness and an old close cannot retire its replacement", () => {
	const f = fixture();
	try {
		f.ready();
		expect(() => f.bridge.attach(f.transport)).toThrow("already attached");
		f.peer.close();
		const newer = f.bridge.attach(f.transport);
		newer.receive(JSON.stringify(hello));
		f.peer.close();
		expect(f.bridge.isReady()).toBe(true);
		newer.close();
		expect(f.bridge.isReady()).toBe(false);
	} finally {
		f.bridge.dispose();
	}
});

test("list and console requests preserve workspace scope and the original response envelopes", async () => {
	const f = fixture();
	try {
		f.ready();
		const listing = f.bridge.listPanes("owned");
		const request = f.latestRequest();
		expect(request.operation).toEqual({ type: "list", workspaceId: "owned" });
		const panes = [
			{
				paneId: "page",
				workspaceId: "owned",
				url: "http://localhost/owned",
				title: "Owned",
				isLoading: false,
			},
		];
		f.reply(request.id, { panes });
		expect(await listing).toEqual({ panes });
		const reading = f.bridge.console("owned", "page");
		const consoleRequest = f.latestRequest();
		expect(consoleRequest.operation).toEqual({
			type: "console",
			workspaceId: "owned",
			paneId: "page",
		});
		const entries = [{ level: "info", message: "Owned console", timestamp: 1 }];
		f.reply(consoleRequest.id, { entries });
		expect(await reading).toEqual({ entries });
		expect(f.tasks.size).toBe(0);
	} finally {
		f.bridge.dispose();
	}
});

test("unknown and repeated reply IDs cannot settle another request", async () => {
	const f = fixture();
	try {
		f.ready();
		const reading = f.bridge.listPanes("owned"),
			request = f.latestRequest();
		f.reply(crypto.randomUUID(), { panes: [] });
		expect(f.tasks.size).toBe(1);
		f.reply(request.id, { panes: [] });
		expect(await reading).toEqual({ panes: [] });
		f.reply(request.id, { panes: [] });
		expect(f.bridge.isReady()).toBe(true);
	} finally {
		f.bridge.dispose();
	}
});

test("the controlled read deadline rejects once without retrying and discards a late result", async () => {
	const f = fixture();
	try {
		f.ready();
		const reading = f.bridge.listPanes("owned"),
			request = f.latestRequest();
		const outcome = reading.catch((error) => error);
		for (const fire of [...f.tasks.values()]) fire();
		expect(await outcome).toMatchObject({ kind: "timeout" });
		f.reply(request.id, { panes: [] });
		expect(
			f.messages.filter((message) => message.type === "request"),
		).toHaveLength(1);
		expect(f.tasks.size).toBe(0);
		expect(f.bridge.isReady()).toBe(true);
	} finally {
		f.bridge.dispose();
	}
});

test("disconnect rejects pending reads and old-session data cannot reach a new session", async () => {
	const f = fixture();
	try {
		f.ready();
		const first = f.bridge.listPanes("owned"),
			oldRequest = f.latestRequest();
		const outcome = first.catch((error) => error);
		f.peer.close();
		expect(await outcome).toMatchObject({ kind: "unavailable" });
		const newer = f.bridge.attach(f.transport);
		newer.receive(JSON.stringify(hello));
		const second = f.bridge.listPanes("owned"),
			newRequest = f.latestRequest();
		f.reply(oldRequest.id, { panes: [{ paneId: "stale" }] });
		expect(f.tasks.size).toBe(1);
		newer.receive(
			JSON.stringify({
				type: "result",
				id: newRequest.id,
				ok: true,
				value: { panes: [] },
			}),
		);
		expect(await second).toEqual({ panes: [] });
	} finally {
		f.bridge.dispose();
	}
});

test("a malformed result closes the channel and does not return foreign data", async () => {
	const f = fixture();
	try {
		f.ready();
		const reading = f.bridge.listPanes("owned"),
			request = f.latestRequest();
		const outcome = reading.catch((error) => error);
		f.reply(request.id, { entries: [] });
		expect(await outcome).toMatchObject({ kind: "invalid" });
		expect(f.bridge.isReady()).toBe(false);
		expect(f.closed).toHaveLength(1);
		expect(f.tasks.size).toBe(0);
	} finally {
		f.bridge.dispose();
	}
});

test("the pending-read bound refuses another request and shutdown releases all timers", async () => {
	const f = fixture();
	try {
		f.ready();
		const reads = Array.from({ length: 8 }, () =>
			f.bridge.listPanes("owned").catch((error) => error),
		);
		await expect(f.bridge.listPanes("owned")).rejects.toMatchObject({
			kind: "busy",
		});
		expect(
			f.messages.filter((message) => message.type === "request"),
		).toHaveLength(8);
		f.bridge.dispose();
		expect(
			(await Promise.all(reads)).every((error) => error.kind === "unavailable"),
		).toBe(true);
		expect(f.tasks.size).toBe(0);
		expect(() => f.bridge.attach(f.transport)).toThrow("unavailable");
	} finally {
		f.bridge.dispose();
	}
});

test("a transport write failure rejects the request and retires that channel", async () => {
	const f = fixture();
	try {
		f.ready();
		f.failWrites();
		await expect(f.bridge.listPanes("owned")).rejects.toMatchObject({
			kind: "unavailable",
		});
		expect(f.bridge.isReady()).toBe(false);
		expect(f.tasks.size).toBe(0);
	} finally {
		f.bridge.dispose();
	}
});

test("an abandoned handshake releases the peer slot at its controlled deadline", async () => {
	const f = fixture();
	try {
		await expect(f.bridge.listPanes("owned")).rejects.toMatchObject({
			kind: "unavailable",
		});
		for (const fire of [...f.tasks.values()]) fire();
		expect(f.tasks.size).toBe(0);
		expect(f.closed).toHaveLength(1);
		const newer = f.bridge.attach(f.transport);
		newer.receive(JSON.stringify(hello));
		expect(f.bridge.isReady()).toBe(true);
	} finally {
		f.bridge.dispose();
	}
});

test("a structurally valid list result from another workspace is rejected", async () => {
	const f = fixture();
	try {
		f.ready();
		const reading = f.bridge.listPanes("owned"),
			request = f.latestRequest();
		const outcome = reading.catch((error) => error);
		f.reply(request.id, {
			panes: [
				{
					paneId: "page",
					workspaceId: "foreign",
					url: "http://localhost/foreign",
					title: "Foreign",
					isLoading: false,
				},
			],
		});
		expect(await outcome).toMatchObject({ kind: "invalid" });
		expect(f.bridge.isReady()).toBe(false);
	} finally {
		f.bridge.dispose();
	}
});

test("a peer error settles the read and preserves the channel without retrying", async () => {
	const f = fixture();
	try {
		f.ready();
		const reading = f.bridge.console("owned", "page"),
			request = f.latestRequest();
		const outcome = reading.catch((error) => error);
		f.peer.receive(
			JSON.stringify({
				type: "result",
				id: request.id,
				ok: false,
				error: { message: "Owned pane closed" },
			}),
		);
		expect(await outcome).toMatchObject({
			kind: "failed",
			message: "Owned pane closed",
		});
		expect(f.bridge.isReady()).toBe(true);
		expect(f.tasks.size).toBe(0);
		expect(
			f.messages.filter((message) => message.type === "request"),
		).toHaveLength(1);
	} finally {
		f.bridge.dispose();
	}
});

test("a failed handshake acknowledgement does not advertise readiness", () => {
	const f = fixture();
	try {
		f.failWrites();
		f.ready();
		expect(f.bridge.isReady()).toBe(false);
		expect(f.closed[0]?.code).toBe(1011);
		expect(f.tasks.size).toBe(0);
	} finally {
		f.bridge.dispose();
	}
});

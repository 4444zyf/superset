import { expect, test } from "bun:test";
import type { BrowserCdpPacket } from "@superset/shared/browser-cdp-bridge";
import { BROWSER_CDP_ACK_TIMEOUT_MS } from "@superset/shared/browser-cdp-bridge";
import { BrowserCdpTransfer } from "./browser-cdp-transfer";

function fixture() {
	const packets: BrowserCdpPacket[] = [],
		messages: string[] = [],
		closes: Array<{ code: number; reason: string }> = [],
		timers: Array<{ ms: number; callback: () => void; cancelled: boolean }> =
			[];
	let current = true,
		invalidations = 0;
	let transfer: BrowserCdpTransfer;
	transfer = new BrowserCdpTransfer({
		schedule: (ms, callback) => {
			const t = { ms, callback, cancelled: false };
			timers.push(t);
			return () => {
				t.cancelled = true;
			};
		},
	});
	const target = {
		current: () => current,
		send: (p: BrowserCdpPacket) => {
			packets.push(p);
		},
		invalidate: () => {
			invalidations++;
			current = false;
			transfer.disconnect();
		},
	};
	const client = {
		send: (r: string) => {
			messages.push(r);
		},
		close: (code: number, reason: string) => {
			closes.push({ code, reason });
		},
	};
	const connect = () =>
		transfer.connect(
			{ workspaceId: "workspace", paneId: "pane" },
			client,
			target,
		);
	return {
		transfer,
		packets,
		messages,
		closes,
		timers,
		target,
		client,
		connect,
		retire: () => {
			current = false;
		},
		invalidations: () => invalidations,
	};
}
function opening(f: ReturnType<typeof fixture>) {
	const p = f.packets.find((p) => p.type === "cdp-open");
	if (!p || p.type !== "cdp-open") throw Error("No captured CDP open");
	return p;
}
test("a CDP connection pins its peer, queues client frames and flushes once after the matching ack", () => {
	const f = fixture(),
		c = f.connect(),
		p = opening(f);
	expect(p).toMatchObject({ workspaceId: "workspace", paneId: "pane" });
	c.receive(' {"id":1,"method":"Target.getTargets"} ');
	expect(f.packets).toHaveLength(1);
	f.transfer.receive({
		type: "cdp-open-result",
		sessionId: crypto.randomUUID(),
		ok: true,
	});
	expect(f.packets).toHaveLength(1);
	f.transfer.receive({
		type: "cdp-open-result",
		sessionId: p.sessionId,
		ok: true,
	});
	expect(f.packets[1]).toEqual({
		type: "cdp-input",
		sessionId: p.sessionId,
		raw: ' {"id":1,"method":"Target.getTargets"} ',
	});
	expect(f.timers[0]?.cancelled).toBe(true);
	f.transfer.receive({
		type: "cdp-output",
		sessionId: p.sessionId,
		raw: '{"id":1,"result":{"中文":"🙂"}}',
	});
	expect(f.messages).toEqual(['{"id":1,"result":{"中文":"🙂"}}']);
	c.close();
	expect(f.packets.at(-1)).toEqual({
		type: "cdp-close",
		sessionId: p.sessionId,
		code: 1000,
	});
	expect(f.closes).toHaveLength(1);
});
test("original busy and detach closes affect only the captured CDP client", () => {
	const f = fixture();
	const a = f.connect(),
		first = opening(f);
	f.transfer.receive({
		type: "cdp-open-result",
		sessionId: first.sessionId,
		ok: false,
		code: 1013,
	});
	expect(f.closes[0]?.code).toBe(1013);
	const b = f.connect(),
		second = f.packets.filter((p) => p.type === "cdp-open").at(-1);
	if (!second) throw Error("Missing second open");
	f.transfer.receive({
		type: "cdp-open-result",
		sessionId: second.sessionId,
		ok: true,
	});
	a.close();
	expect(f.closes).toHaveLength(1);
	f.transfer.receive({
		type: "cdp-close",
		sessionId: second.sessionId,
		code: 1011,
	});
	expect(f.closes).toHaveLength(2);
	b.close();
	expect(f.closes).toHaveLength(2);
});
test("pending CDP buffers enforce the original 64-frame and four MiB budgets", () => {
	const f = fixture(),
		c = f.connect();
	for (let i = 0; i < 64; i++) c.receive("{}");
	expect(f.closes).toEqual([]);
	c.receive("{}");
	expect(f.closes[0]?.code).toBe(1009);
	const g = fixture(),
		d = g.connect();
	d.receive("x".repeat(4 * 1024 * 1024));
	d.receive("x");
	expect(g.closes[0]?.code).toBe(1009);
});
test("a controlled opening timeout retires the peer and never retries or reuses its pending session", () => {
	const f = fixture(),
		c = f.connect(),
		p = opening(f);
	expect(f.timers[0]?.ms).toBe(BROWSER_CDP_ACK_TIMEOUT_MS);
	f.timers[0]?.callback();
	expect(f.invalidations()).toBe(1);
	expect(f.closes).toHaveLength(1);
	expect(f.packets.filter((p) => p.type === "cdp-open")).toHaveLength(1);
	f.transfer.receive({
		type: "cdp-open-result",
		sessionId: p.sessionId,
		ok: true,
	});
	c.receive("late");
	c.close();
	expect(f.packets).toHaveLength(1);
});
test("closing a pending client cancels the ack timer and tells Main to release only that session", () => {
	const f = fixture(),
		c = f.connect(),
		p = opening(f);
	c.close();
	expect(f.timers[0]?.cancelled).toBe(true);
	expect(f.packets.at(-1)).toEqual({
		type: "cdp-close",
		sessionId: p.sessionId,
		code: 1000,
	});
	f.timers[0]?.callback();
	expect(f.invalidations()).toBe(0);
	f.transfer.receive({
		type: "cdp-open-result",
		sessionId: p.sessionId,
		ok: true,
	});
	expect(f.packets.filter((p) => p.type === "cdp-input")).toEqual([]);
});
test("retired peers cannot send incoming commands or return outgoing events", () => {
	for (const direction of ["inbound", "outbound"]) {
		const f = fixture(),
			c = f.connect(),
			p = opening(f);
		f.transfer.receive({
			type: "cdp-open-result",
			sessionId: p.sessionId,
			ok: true,
		});
		f.retire();
		if (direction === "inbound") c.receive("stale");
		else
			f.transfer.receive({
				type: "cdp-output",
				sessionId: p.sessionId,
				raw: "stale",
			});
		expect(f.messages).toEqual([]);
		expect(f.packets).toHaveLength(1);
		expect(f.closes).toHaveLength(1);
	}
});
test("disconnect clears pending and live clients before a replacement peer can attach", () => {
	const f = fixture(),
		old = f.connect(),
		p = opening(f);
	f.transfer.disconnect();
	f.transfer.receive({
		type: "cdp-output",
		sessionId: p.sessionId,
		raw: "old",
	});
	const fresh = f.connect();
	old.receive("late old");
	old.close();
	expect(f.closes).toHaveLength(1);
	expect(f.messages).toEqual([]);
	expect(f.packets.filter((p) => p.type === "cdp-open")).toHaveLength(2);
	fresh.close();
	expect(f.closes).toHaveLength(2);
});
test("a transport send failure closes all captured clients without replay", () => {
	const f = fixture();
	f.target.send = () => {
		throw Error("transport closed");
	};
	f.connect();
	expect(f.invalidations()).toBe(1);
	expect(f.closes).toHaveLength(1);
	expect(f.packets).toEqual([]);
});
test("CDP client callbacks cannot throw through the browser bridge receive handler", () => {
	const f = fixture();
	f.client.send = () => {
		throw Error("client closed");
	};
	f.client.close = () => {
		throw Error("client already closed");
	};
	f.connect();
	const p = opening(f);
	f.transfer.receive({
		type: "cdp-open-result",
		sessionId: p.sessionId,
		ok: true,
	});
	expect(() =>
		f.transfer.receive({
			type: "cdp-output",
			sessionId: p.sessionId,
			raw: "event",
		}),
	).not.toThrow();
	expect(f.packets.at(-1)?.type).toBe("cdp-close");
});
test("open attempts require a current peer and overall CDP slots stay bounded", () => {
	const f = fixture();
	f.retire();
	expect(() => f.connect()).toThrow();
	expect(f.packets).toEqual([]);
	const g = fixture();
	for (let i = 0; i < 16; i++) g.connect();
	expect(() => g.connect()).toThrow();
	expect(g.packets).toHaveLength(16);
	g.transfer.disconnect();
	expect(g.closes).toHaveLength(16);
});

test("disconnect callbacks cannot close a replacement connection created during teardown", () => {
	const f = fixture();
	let replaced = false;
	f.client.close = (code, reason) => {
		f.closes.push({ code, reason });
		if (!replaced) {
			replaced = true;
			f.transfer.connect(
				{ workspaceId: "replacement", paneId: "new-pane" },
				{
					send: () => {},
					close: (code, reason) => f.closes.push({ code, reason }),
				},
				{ ...f.target },
			);
		}
	};
	f.connect();
	f.transfer.disconnect();
	expect(f.closes).toHaveLength(1);
	expect(f.packets.filter((p) => p.type === "cdp-open")).toHaveLength(2);
	f.transfer.disconnect();
	expect(f.closes).toHaveLength(2);
});
test("a failing peer-retirement callback still releases every captured connection", () => {
	const f = fixture();
	f.target.invalidate = () => {
		throw Error("peer teardown failed");
	};
	f.connect();
	f.connect();
	f.timers[0]?.callback();
	expect(f.closes).toHaveLength(2);
	expect(f.timers.every((t) => t.cancelled)).toBe(true);
});

test("request metadata cannot replace the generated CDP session identity", () => {
	const f = fixture();
	f.connect();
	const original = opening(f);
	f.transfer.connect(
		{
			workspaceId: "workspace",
			paneId: "pane",
			sessionId: original.sessionId,
		} as never,
		f.client,
		f.target,
	);
	const opened = f.packets.filter((p) => p.type === "cdp-open");
	expect(opened[1]?.sessionId).not.toBe(original.sessionId);
	f.transfer.disconnect();
	expect(f.closes).toHaveLength(2);
});

test("CDP responses larger than the original input budget remain available to the client", () => {
	const f = fixture();
	f.connect();
	const p = opening(f);
	f.transfer.receive({
		type: "cdp-open-result",
		sessionId: p.sessionId,
		ok: true,
	});
	const raw =
		'{"id":1,"result":{"data":"' + "x".repeat(4 * 1024 * 1024) + '"}}';
	f.transfer.receive({ type: "cdp-output", sessionId: p.sessionId, raw });
	expect(f.messages).toHaveLength(1);
	expect(f.messages[0] === raw).toBe(true);
	expect(f.closes).toEqual([]);
});

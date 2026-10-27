import { expect, test } from "bun:test";
import {
	encodeBrowserBridgePacket,
	parseBrowserBridgePacket,
} from "@superset/shared/browser-bridge";
import {
	encodeBrowserCdpPacket,
	parseBrowserCdpPacket,
} from "@superset/shared/browser-cdp-bridge";
import { describeDirectBackend } from "../trpc/router/direct/direct";
import { DirectBrowserReadBridge } from "./browser-read-bridge";

const identity = {
	backendId: "backend",
	namespaceId: "namespace",
	instanceId: "instance",
};
function fixture() {
	const sent: string[] = [],
		peerCloses: number[] = [],
		messages: string[] = [],
		closes: number[] = [],
		timers: Array<{ ms: number; cb: () => void; cancelled: boolean }> = [];
	const bridge = new DirectBrowserReadBridge(identity, {
		schedule: (ms, cb) => {
			const t = { ms, cb, cancelled: false };
			timers.push(t);
			return () => {
				t.cancelled = true;
			};
		},
	});
	let queuedBytes = 0;
	const transport = {
		bufferedAmount: () => queuedBytes,
		send: (raw: string) => {
			sent.push(raw);
		},
		close: (code: number) => {
			peerCloses.push(code);
		},
	};
	let channel = bridge.attach(transport);
	const hello = (features = ["readV1", "cdpV1"]) =>
		channel.receive(
			encodeBrowserBridgePacket({
				type: "hello",
				protocol: 1,
				...identity,
				features,
			}),
		);
	const connect = () =>
		bridge.connectCdp(
			{ workspaceId: "workspace", paneId: "pane" },
			{
				send: (raw) => {
					messages.push(raw);
				},
				close: (code) => {
					closes.push(code);
				},
			},
		);
	const open = () => {
		for (const raw of sent) {
			try {
				const p = parseBrowserCdpPacket(raw);
				if (p.type === "cdp-open") return p;
			} catch {}
		}
		throw Error("Missing CDP open");
	};
	return {
		bridge,
		setQueuedBytes: (value: number) => {
			queuedBytes = value;
		},
		sent,
		lastSent: () => {
			const raw = sent.at(-1);
			if (raw === undefined) throw Error("No captured peer packet");
			return raw;
		},
		peerCloses,
		messages,
		closes,
		timers,
		hello,
		connect,
		open,
		receive: (raw: string) => channel.receive(raw),
		close: () => channel.close(),
		replace: () => {
			channel = bridge.attach(transport);
		},
	};
}
test("only explicit CDP negotiation enables the optional capability without requiring mutation journaling", () => {
	const f = fixture();
	expect(f.bridge.isCdpReady()).toBe(false);
	f.hello(["readV1", "capturePngV1"]);
	expect(f.bridge.isCdpReady()).toBe(false);
	expect(() => f.connect()).toThrow();
	f.close();
	f.replace();
	f.hello();
	expect(f.bridge.isCdpReady()).toBe(true);
	expect(parseBrowserBridgePacket(f.lastSent()).type).toBe("ready");
	const description = describeDirectBackend(
		{ ...identity, serviceUid: process.getuid?.() ?? 1000 } as never,
		false,
		false,
		f.bridge,
	);
	expect(description.capabilities.workstationBrowserCdpV1).toBe(true);
	expect(description.capabilities.durableOperations).toBe(false);
});
test("the original peer carries dedicated CDP frames and retains larger screenshot responses", () => {
	const f = fixture();
	f.hello();
	const c = f.connect(),
		p = f.open();
	c.receive(' {"id":1,"method":"Target.getTargets"} ');
	f.receive(
		encodeBrowserCdpPacket({
			type: "cdp-open-result",
			sessionId: p.sessionId,
			ok: true,
		}),
	);
	expect(parseBrowserCdpPacket(f.lastSent())).toEqual({
		type: "cdp-input",
		sessionId: p.sessionId,
		raw: ' {"id":1,"method":"Target.getTargets"} ',
	});
	const raw = `{"id":1,"result":{"data":"${"x".repeat(4 * 1024 * 1024)}"}}`;
	f.receive(
		encodeBrowserCdpPacket({ type: "cdp-output", sessionId: p.sessionId, raw }),
	);
	expect(f.messages).toHaveLength(1);
	expect(f.messages[0] === raw).toBe(true);
	expect(f.bridge.isReady()).toBe(true);
	c.close();
	expect(parseBrowserCdpPacket(f.lastSent()).type).toBe("cdp-close");
});
test("a rejected oversized CDP client command leaves original read requests usable", async () => {
	const f = fixture();
	f.hello();
	const c = f.connect(),
		p = f.open();
	f.receive(
		encodeBrowserCdpPacket({
			type: "cdp-open-result",
			sessionId: p.sessionId,
			ok: true,
		}),
	);
	c.receive("x".repeat(4 * 1024 * 1024 + 1));
	expect(f.closes).toEqual([1009]);
	expect(f.bridge.isReady()).toBe(true);
	const pending = f.bridge.listPanes("workspace");
	const request = parseBrowserBridgePacket(f.lastSent());
	if (request.type !== "request") throw Error("Missing old read request");
	f.receive(
		encodeBrowserBridgePacket({
			type: "result",
			id: request.id,
			ok: true,
			value: { panes: [] },
		}),
	);
	expect(await pending).toEqual({ panes: [] });
});
test("disconnect retires exact CDP handles and late old frames cannot reach a replacement", () => {
	const f = fixture();
	f.hello();
	const old = f.connect(),
		p = f.open();
	f.close();
	expect(f.closes).toEqual([1011]);
	expect(f.bridge.isCdpReady()).toBe(false);
	f.replace();
	f.hello();
	f.connect();
	old.receive("late");
	old.close();
	f.receive(
		encodeBrowserCdpPacket({
			type: "cdp-output",
			sessionId: p.sessionId,
			raw: "late",
		}),
	);
	expect(f.messages).toEqual([]);
	expect(f.closes).toHaveLength(1);
});
test("wrong-direction CDP frames retire their peer and all exact clients", () => {
	const f = fixture();
	f.hello();
	f.connect();
	const p = f.open();
	f.receive(
		encodeBrowserCdpPacket({
			type: "cdp-input",
			sessionId: p.sessionId,
			raw: "wrong",
		}),
	);
	expect(f.bridge.isCdpReady()).toBe(false);
	expect(f.peerCloses).toHaveLength(1);
	expect(f.closes).toEqual([1011]);
});
test("CDP frames before or without negotiation are rejected by the old strict reader", () => {
	for (const ready of [false, true]) {
		const f = fixture();
		if (ready) f.hello(["readV1"]);
		f.receive(
			encodeBrowserCdpPacket({
				type: "cdp-open-result",
				sessionId: crypto.randomUUID(),
				ok: true,
			}),
		);
		expect(f.peerCloses).toHaveLength(1);
		expect(f.bridge.isReady()).toBe(false);
	}
});

test("a full CDP peer send queue retires only its captured connection epoch", () => {
	const f = fixture();
	f.hello();
	f.setQueuedBytes(5 * 1024 * 1024);
	f.connect();
	expect(f.bridge.isCdpReady()).toBe(false);
	expect(f.closes).toEqual([1011]);
	expect(f.peerCloses).toHaveLength(1);
});

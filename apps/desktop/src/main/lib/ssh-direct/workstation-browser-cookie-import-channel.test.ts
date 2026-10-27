import { expect, test } from "bun:test";
import { WorkstationBrowserCookieImportError } from "./workstation-browser-cookie-imports";
import {
	type BrowserReadTarget,
	WorkstationBrowserReadChannels,
} from "./workstation-browser-read-channel";

class Socket extends EventTarget {
	sent: Record<string, unknown>[] = [];
	closes: number[] = [];
	send(raw: string) {
		this.sent.push(JSON.parse(raw));
	}
	close(code = 1000) {
		this.closes.push(code);
	}
	packet(packet: unknown) {
		this.dispatchEvent(
			new MessageEvent("message", { data: JSON.stringify(packet) }),
		);
	}
}
function fixture(importCookiesV1 = false, callback = true) {
	let target: BrowserReadTarget = {
		ownerId: 7,
		ownerEpoch: 1,
		descriptor: {
			connectionId: "connection",
			generation: 1,
			backendId: "backend",
			namespaceId: "namespace",
			instanceId: "instance",
		},
	};
	const socket = new Socket(),
		done = Promise.withResolvers<unknown>(),
		calls: unknown[] = [];
	let releases = 0,
		pinFailure: Error | null = null;
	const channels = new WorkstationBrowserReadChannels({
		importCookiesV1,
		...(callback
			? {
					pinCookieImport: (
						captured: BrowserReadTarget,
						request: unknown,
						current: () => boolean,
					) => {
						calls.push([captured, request, current()]);
						if (pinFailure) throw pinFailure;
						return Object.assign(() => done.promise, {
							release: () => {
								releases++;
							},
						});
					},
				}
			: {}),
		getTarget: () => target,
		openSocket: () => socket as unknown as WebSocket,
		panes: () => ({
			listPanes: () => [],
			getConsoleLogs: () => [],
			capturePng: async () => "",
		}),
	});
	channels.sync("connection");
	socket.dispatchEvent(new Event("open"));
	const ready = () =>
		socket.packet({
			type: "ready",
			protocol: 1,
			backendId: "backend",
			namespaceId: "namespace",
			instanceId: "instance",
			features: ["readV1", "importCookiesV1"],
		});
	const request = () => {
		const packet = {
			type: "import-cookies-request",
			id: crypto.randomUUID(),
			workspaceId: "owned",
			paneId: "page",
			sourceId: "/owned/Default",
		};
		socket.packet(packet);
		return packet;
	};
	return {
		channels,
		socket,
		done,
		calls,
		ready,
		request,
		releases: () => releases,
		target: () => target,
		retire: () => {
			target = { ...target, ownerEpoch: 2 };
		},
		failPin: (error: Error) => {
			pinFailure = error;
		},
	};
}
test("cookie import requires both explicit desktop opt-in and a real pin callback", () => {
	for (const f of [fixture(), fixture(true, false)]) {
		f.ready();
		f.request();
		expect(f.socket.sent[0]?.features).toEqual(["readV1", "capturePngV1"]);
		expect(f.calls).toEqual([]);
		expect(f.socket.closes).toEqual([1008]);
	}
});
test("the negotiated import response keeps its captured owner and original key-unavailable counts", async () => {
	const f = fixture(true);
	f.ready();
	const request = f.request();
	expect(f.calls).toEqual([[f.target(), request, true]]);
	expect(f.socket.sent).toHaveLength(1);
	const result = { imported: 0, skipped: 0, keyUnavailable: true };
	f.done.resolve(result);
	await f.done.promise;
	expect(f.socket.sent[1]).toEqual({
		type: "import-cookies-result",
		id: request.id,
		ok: true,
		result,
	});
	expect(f.releases()).toBe(1);
	f.channels.closeAll();
});
test("closing an import channel cancels its pin once and cannot acknowledge a later epoch", async () => {
	const f = fixture(true);
	f.ready();
	f.request();
	f.retire();
	f.channels.sync("connection");
	expect(f.releases()).toBe(1);
	f.done.resolve({ imported: 1, skipped: 0, keyUnavailable: false });
	await f.done.promise;
	expect(f.socket.sent).toHaveLength(1);
	expect(f.releases()).toBe(1);
	expect(f.socket.closes).toEqual([1000]);
});
test("a second import packet cannot dispatch another import before the first settles", async () => {
	const f = fixture(true);
	f.ready();
	f.request();
	f.request();
	expect(f.calls).toHaveLength(1);
	expect(f.socket.closes).toEqual([1008]);
	expect(f.releases()).toBe(1);
	f.done.resolve({ imported: 0, skipped: 0, keyUnavailable: false });
	await f.done.promise;
	expect(f.socket.sent).toHaveLength(1);
	expect(f.releases()).toBe(1);
});
test("busy session errors remain explicit and do not release another import pin", async () => {
	const f = fixture(true);
	f.ready();
	f.failPin(
		new WorkstationBrowserCookieImportError("busy", "Owned session busy"),
	);
	const request = f.request();
	await Promise.resolve();
	expect(f.socket.sent[1]).toMatchObject({
		type: "import-cookies-result",
		id: request.id,
		ok: false,
		error: { kind: "busy" },
	});
	expect(f.releases()).toBe(0);
	f.channels.closeAll();
});
test("invalid counts cannot be reported as success or disclose private cookie data", async () => {
	const f = fixture(true);
	f.ready();
	const request = f.request();
	f.done.resolve({
		imported: -1,
		skipped: 0,
		keyUnavailable: false,
		cookies: "OWNED-PRIVATE-COOKIE",
	});
	await f.done.promise;
	expect(f.socket.sent[1]).toMatchObject({
		type: "import-cookies-result",
		id: request.id,
		ok: false,
		error: { kind: "failed" },
	});
	expect(JSON.stringify(f.socket.sent[1])).not.toContain(
		"OWNED-PRIVATE-COOKIE",
	);
	expect(f.releases()).toBe(1);
	f.channels.closeAll();
});
test("only aggregate result fields cross the import bridge", async () => {
	const f = fixture(true);
	f.ready();
	const request = f.request();
	f.done.resolve({
		imported: 1,
		skipped: 0,
		keyUnavailable: false,
		cookies: "OWNED-PRIVATE-COOKIE",
	});
	await f.done.promise;
	expect(f.socket.sent[1]).toEqual({
		type: "import-cookies-result",
		id: request.id,
		ok: true,
		result: { imported: 1, skipped: 0, keyUnavailable: false },
	});
	expect(f.releases()).toBe(1);
	f.channels.closeAll();
});

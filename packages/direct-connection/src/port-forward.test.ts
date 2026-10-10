import { afterEach, describe, expect, test } from "bun:test";
import { once } from "node:events";
import net from "node:net";
import {
	decodeMuxFrame,
	decodeOpenPort,
	encodeData,
	encodeEof,
	encodeHello,
	encodeOpened,
	encodeOpenFail,
	encodeWindow,
	MUX_INITIAL_WINDOW_BYTES,
	MUX_MAX_DATA_BYTES,
	type MuxFrame,
	MuxFrameType,
	MuxOpenFailCode,
} from "@superset/shared/port-forward-mux";
import type { ConnectionLease } from "./manager";
import { DirectPortForwardManager } from "./port-forward";

class TestSocket extends EventTarget {
	readyState = 1;
	binaryType = "arraybuffer";
	bufferedAmount = 0;
	frames: MuxFrame[] = [];
	closed = false;
	onSend: (frame: MuxFrame) => void = () => {};
	send(bytes: Uint8Array) {
		const frame = decodeMuxFrame(bytes);
		if (!frame) throw new Error("Invalid test frame");
		this.frames.push(frame);
		this.onSend(frame);
	}
	receive(bytes: Uint8Array) {
		this.dispatchEvent(new MessageEvent("message", { data: bytes.buffer }));
	}
	close() {
		if (this.closed) return;
		this.closed = true;
		this.readyState = 3;
		this.dispatchEvent(new Event("close"));
	}
}

const cleanups: (() => void)[] = [];
afterEach(() => {
	for (const cleanup of cleanups.splice(0)) cleanup();
});

function fixture(options: { hello?: boolean; allowed?: boolean } = {}) {
	let lease: ConnectionLease | null = {
		connectionId: "mini",
		generation: 1,
		backendId: "backend",
		namespaceId: "namespace",
		instanceId: "boot",
		url: "http://127.0.0.1:45678",
	};
	const sockets: TestSocket[] = [];
	const paths: string[] = [];
	const manager = new DirectPortForwardManager({
		getLease: () => lease && { ...lease },
		openSocket: (_id, path) => {
			paths.push(path);
			const socket = new TestSocket();
			sockets.push(socket);
			socket.onSend = (frame) => {
				if (frame.type === MuxFrameType.open) {
					queueMicrotask(() => {
						if (options.allowed === false) {
							socket.receive(
								encodeOpenFail(
									frame.streamId,
									MuxOpenFailCode.portNotOwned,
									"port not owned by workspace",
								),
							);
						} else socket.receive(encodeOpened(frame.streamId));
					});
				}
			};
			if (options.hello !== false)
				queueMicrotask(() => socket.receive(encodeHello()));
			return socket as unknown as WebSocket;
		},
	});
	cleanups.push(() => manager.dispose());
	return {
		manager,
		sockets,
		paths,
		socket: () => {
			const socket = sockets[0];
			if (!socket) throw new Error("Forward socket was not created");
			return socket;
		},
		revoke: () => {
			lease = null;
		},
	};
}

async function client(port: number) {
	const socket = net.connect({ host: "127.0.0.1", port });
	cleanups.push(() => socket.destroy());
	await once(socket, "connect");
	return socket;
}

describe("SSH direct development port forwarding", () => {
	test("forwards HTTP on an atomic loopback listener using the guarded workspace mux", async () => {
		const f = fixture();
		const forward = await f.manager.open("mini", "workspace/with spaces", 3000);
		const ws = f.socket();
		ws.onSend = (frame) => {
			if (frame.type === MuxFrameType.open)
				queueMicrotask(() => ws.receive(encodeOpened(frame.streamId)));
			if (frame.type === MuxFrameType.data) {
				queueMicrotask(() => {
					ws.receive(
						encodeData(
							frame.streamId,
							Buffer.from(
								"HTTP/1.1 200 OK\r\nContent-Length: 6\r\nConnection: close\r\n\r\nremote",
							),
						),
					);
					ws.receive(encodeEof(frame.streamId));
				});
			}
		};
		expect(await (await fetch(`${forward.url}/preview`)).text()).toBe("remote");
		expect(forward.url).toBe(`http://127.0.0.1:${forward.localPort}`);
		expect(f.paths).toEqual(["/fwd?workspaceId=workspace%2Fwith+spaces"]);
		expect(
			ws.frames
				.filter((frame) => frame.type === MuxFrameType.open)
				.map(decodeOpenPort),
		).toEqual([3000, 3000]);
		expect(Object.keys(forward).sort()).toEqual([
			"connectionId",
			"id",
			"localPort",
			"url",
		]);
	});

	test("refuses a port the backend does not attribute to the workspace before binding", async () => {
		const f = fixture({ allowed: false });
		await expect(f.manager.open("mini", "workspace", 3000)).rejects.toThrow(
			"owned",
		);
		expect(f.sockets[0]?.closed).toBe(true);
	});

	test("rejects malformed port and workspace values without opening a socket", async () => {
		const f = fixture();
		for (const port of [0, 65536, 1.5, NaN]) {
			await expect(f.manager.open("mini", "workspace", port)).rejects.toThrow(
				"port",
			);
		}
		await expect(f.manager.open("mini", "", 3000)).rejects.toThrow("workspace");
		expect(f.sockets).toHaveLength(0);
	});

	test("a revoked generation cannot finish opening and leave an orphan listener", async () => {
		const f = fixture({ hello: false });
		const opening = f.manager.open("mini", "workspace", 3000);
		f.revoke();
		f.socket().receive(encodeHello());
		await expect(opening).rejects.toThrow("disconnected");
		expect(f.sockets[0]?.closed).toBe(true);
	});

	test("disconnect closes listeners and mux sockets without stopping a remote process", async () => {
		const f = fixture();
		const forward = await f.manager.open("mini", "workspace", 3000);
		f.manager.closeConnection("mini");
		expect(f.sockets[0]?.closed).toBe(true);
		await expect(fetch(forward.url)).rejects.toThrow();
		expect(
			f
				.socket()
				.frames.every(
					(frame) =>
						frame.type === MuxFrameType.open ||
						frame.type === MuxFrameType.close,
				),
		).toBe(true);
	});

	test("local writes stop at the remote credit window and resume only after credit", async () => {
		const f = fixture();
		const forward = await f.manager.open("mini", "workspace", 3000);
		const ws = f.socket();
		let received = 0;
		let streamId = 0;
		let fill: () => void = () => {};
		let finish: () => void = () => {};
		const filled = new Promise<void>((resolve) => {
			fill = resolve;
		});
		const finished = new Promise<void>((resolve) => {
			finish = resolve;
		});
		ws.onSend = (frame) => {
			if (frame.type === MuxFrameType.open) {
				streamId = frame.streamId;
				queueMicrotask(() => ws.receive(encodeOpened(frame.streamId)));
			}
			if (frame.type === MuxFrameType.data) {
				received += frame.payload.byteLength;
				expect(frame.payload.byteLength).toBeLessThanOrEqual(
					MUX_MAX_DATA_BYTES,
				);
				if (received === MUX_INITIAL_WINDOW_BYTES) fill();
				if (received === MUX_INITIAL_WINDOW_BYTES + 1) finish();
			}
		};
		const tcp = await client(forward.localPort);
		tcp.write(Buffer.alloc(MUX_INITIAL_WINDOW_BYTES + 1));
		await filled;
		expect(received).toBe(MUX_INITIAL_WINDOW_BYTES);
		ws.receive(encodeWindow(streamId, 1));
		await finished;
	});

	test("an unsolicited excess window credit closes the forward instead of growing its budget", async () => {
		const f = fixture();
		const forward = await f.manager.open("mini", "workspace", 3000);
		const ws = f.socket();
		let opened: () => void = () => {};
		const ready = new Promise<void>((resolve) => {
			opened = resolve;
		});
		ws.onSend = (frame) => {
			if (frame.type === MuxFrameType.open) {
				ws.receive(encodeOpened(frame.streamId));
				ws.receive(encodeWindow(frame.streamId, MUX_INITIAL_WINDOW_BYTES));
				opened();
			}
		};
		await client(forward.localPort);
		await ready;
		expect(ws.closed).toBe(true);
	});

	test("DATA after a remote EOF is rejected before writing to an ended local socket", async () => {
		const f = fixture();
		const forward = await f.manager.open("mini", "workspace", 3000);
		const ws = f.socket();
		let opened: () => void = () => {};
		const ready = new Promise<void>((resolve) => {
			opened = resolve;
		});
		ws.onSend = (frame) => {
			if (frame.type === MuxFrameType.open) {
				ws.receive(encodeOpened(frame.streamId));
				ws.receive(encodeEof(frame.streamId));
				ws.receive(encodeData(frame.streamId, Buffer.from("too late")));
				opened();
			}
		};
		await client(forward.localPort);
		await ready;
		expect(ws.closed).toBe(true);
	});
});

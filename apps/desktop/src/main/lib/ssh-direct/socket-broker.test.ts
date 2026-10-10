import { expect, test } from "bun:test";
import { SocketBroker } from "./socket-broker";

class FakeSocket extends EventTarget {
	readyState = 1;
	sent: string[] = [];
	closed = false;
	send(data: string) {
		this.sent.push(data);
	}
	close() {
		this.closed = true;
	}
}

test("a renderer cannot send into another window's terminal connection", async () => {
	const socket = new FakeSocket();
	const broker = new SocketBroker(() => socket);
	await broker.open(1, "socket", "machine", "/terminal/session", () => {});
	expect(() => broker.send(2, "socket", "secret command")).toThrow(
		"Socket does not belong",
	);
	expect(socket.sent).toEqual([]);
});

test("closing a renderer closes only its WebSockets and never sends terminal disposal", async () => {
	const socket = new FakeSocket();
	const broker = new SocketBroker(() => socket);
	await broker.open(1, "socket", "machine", "/terminal/session", () => {});
	broker.closeOwner(1);
	expect(socket.closed).toBe(true);
	expect(socket.sent).toEqual([]);
});

test("socket path cannot inject a different origin or host token", async () => {
	let opened = false;
	const broker = new SocketBroker(() => {
		opened = true;
		return new FakeSocket();
	});
	for (const path of [
		"https://attacker.test/terminal/x",
		"//attacker.test/terminal/x",
		"/terminal/x?token=secret",
		"/terminal/x/../x",
		"/terminal/x?create=1",
	]) {
		await expect(
			broker.open(1, "socket", "machine", path, () => {}),
		).rejects.toThrow("Unsupported workstation socket");
	}
	expect(opened).toBe(false);
});

test("terminal bytes remain binary across IPC instead of corrupting UTF-8 fragments", async () => {
	const socket = new FakeSocket();
	const broker = new SocketBroker(() => socket);
	const data: unknown[] = [];
	await broker.open(1, "socket", "machine", "/terminal/session", (event) => {
		if (event.kind === "message") data.push(event.data);
	});
	socket.dispatchEvent(
		new MessageEvent("message", { data: new Uint8Array([0xe4, 0xb8]).buffer }),
	);
	expect(data).toEqual([new Uint8Array([0xe4, 0xb8])]);
});

test("disconnect during asynchronous socket creation closes the late connection", async () => {
	const socket = new FakeSocket();
	let resolve: (socket: FakeSocket) => void = () => {};
	const broker = new SocketBroker(
		() =>
			new Promise<FakeSocket>((done) => {
				resolve = done;
			}),
	);
	const opening = broker.open(
		1,
		"socket",
		"machine",
		"/terminal/session",
		() => {},
	);
	broker.closeConnection("machine");
	resolve(socket);
	await opening;
	expect(socket.closed).toBe(true);
});

test("duplicate socket IDs cannot overwrite an asynchronously opening socket", async () => {
	const socket = new FakeSocket();
	let resolve: (socket: FakeSocket) => void = () => {};
	const broker = new SocketBroker(
		() =>
			new Promise<FakeSocket>((done) => {
				resolve = done;
			}),
	);
	const opening = broker.open(
		1,
		"socket",
		"machine",
		"/terminal/session",
		() => {},
	);
	await expect(
		broker.open(1, "socket", "machine", "/terminal/session", () => {}),
	).rejects.toThrow("already in use");
	resolve(socket);
	await opening;
});

test("stream cleanup after disconnect is idempotent while other owners remain protected", async () => {
	const broker = new SocketBroker(() => new FakeSocket());
	await broker.open(1, "socket", "machine", "/terminal/session", () => {});
	expect(() => broker.close(2, "socket")).toThrow("Socket does not belong");
	broker.closeConnection("machine");
	expect(() => broker.close(1, "socket")).not.toThrow();
	expect(() => broker.close(1, "socket")).not.toThrow();
});

test("closing an opening socket cancels its late subscription without permitting another owner", async () => {
	const socket = new FakeSocket();
	let finish!: (socket: FakeSocket) => void;
	const emitted: unknown[] = [];
	const broker = new SocketBroker(
		() =>
			new Promise<FakeSocket>((resolve) => {
				finish = resolve;
			}),
	);
	const opening = broker.open(
		1,
		"socket",
		"machine",
		"/terminal/session",
		(event) => emitted.push(event),
	);
	expect(() => broker.close(2, "socket")).toThrow("Socket does not belong");
	broker.close(1, "socket");
	finish(socket);
	await opening;
	expect(socket.closed).toBe(true);
	expect(emitted).toEqual([]);
});

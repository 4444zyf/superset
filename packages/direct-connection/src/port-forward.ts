import { randomUUID } from "node:crypto";
import net from "node:net";
import {
	decodeHelloVersion,
	decodeMuxFrame,
	decodeOpenFail,
	decodeWindowDelta,
	encodeClose,
	encodeData,
	encodeEof,
	encodeOpen,
	encodePong,
	encodeWindow,
	MUX_INITIAL_WINDOW_BYTES,
	MUX_MAX_DATA_BYTES,
	MUX_MAX_STREAMS,
	MUX_PROTOCOL_VERSION,
	type MuxFrame,
	MuxFrameType,
} from "@superset/shared/port-forward-mux";
import type { ConnectionLease, DirectConnectionManager } from "./manager";

export interface DirectPortForward {
	id: string;
	connectionId: string;
	localPort: number;
	url: string;
}

type ConnectionTransport = Pick<
	DirectConnectionManager,
	"getLease" | "openSocket"
>;

interface ForwardEntry {
	id: string;
	key: string;
	connectionId: string;
	active: boolean;
	server: net.Server | null;
	session: ForwardMux | null;
	opening: Promise<DirectPortForward>;
}

interface StreamState {
	socket: net.Socket | null;
	opened: boolean;
	sendWindow: number;
	receiveWindow: number;
	queue: Buffer[];
	queuedBytes: number;
	uncredited: number;
	creditScheduled: boolean;
	localEof: boolean;
	remoteEof: boolean;
	eofSent: boolean;
	opening: {
		resolve: () => void;
		reject: (error: Error) => void;
		timer: ReturnType<typeof setTimeout>;
	} | null;
}

const MAX_FORWARDS = 32;
const MAX_QUEUED_BYTES = MUX_INITIAL_WINDOW_BYTES * 2;
const MAX_WEBSOCKET_BUFFER = MUX_INITIAL_WINDOW_BYTES * 4;
const HANDSHAKE_TIMEOUT_MS = 10_000;

export class DirectPortForwardManager {
	private readonly entries = new Map<string, ForwardEntry>();
	private readonly keys = new Map<string, string>();
	private disposed = false;

	constructor(private readonly connections: ConnectionTransport) {}

	async open(
		connectionId: string,
		workspaceId: string,
		remotePort: number,
	): Promise<DirectPortForward> {
		if (!Number.isInteger(remotePort) || remotePort < 1 || remotePort > 65535)
			throw new Error("Invalid remote port");
		if (
			!workspaceId ||
			workspaceId.length > 512 ||
			/[\0\r\n]/.test(workspaceId)
		)
			throw new Error("Invalid workspace ID");
		if (this.disposed) throw new Error("Port forwarding is disposed");
		const lease = this.connections.getLease(connectionId);
		if (!lease) throw new Error("SSH backend is disconnected");
		const key = JSON.stringify([
			connectionId,
			lease.generation,
			workspaceId,
			remotePort,
		]);
		const existing = this.entries.get(this.keys.get(key) ?? "");
		if (existing) return existing.opening;
		if (this.entries.size >= MAX_FORWARDS)
			throw new Error("Too many forwarded ports");
		const entry: ForwardEntry = {
			id: randomUUID(),
			key,
			connectionId,
			active: true,
			server: null,
			session: null,
			opening: null as unknown as Promise<DirectPortForward>,
		};
		this.entries.set(entry.id, entry);
		this.keys.set(key, entry.id);
		entry.opening = this.start(entry, lease, workspaceId, remotePort).catch(
			(error) => {
				this.close(entry.id);
				throw error;
			},
		);
		return entry.opening;
	}

	close(id: string): void {
		const entry = this.entries.get(id);
		if (!entry) return;
		entry.active = false;
		this.entries.delete(id);
		if (this.keys.get(entry.key) === id) this.keys.delete(entry.key);
		entry.server?.close(() => {});
		entry.session?.close(new Error("Port forward disconnected"));
	}

	closeConnection(connectionId: string): void {
		for (const entry of this.entries.values()) {
			if (entry.connectionId === connectionId) this.close(entry.id);
		}
	}

	dispose(): void {
		this.disposed = true;
		for (const id of this.entries.keys()) this.close(id);
	}

	private async start(
		entry: ForwardEntry,
		lease: ConnectionLease,
		workspaceId: string,
		remotePort: number,
	): Promise<DirectPortForward> {
		const current = () => {
			const live = this.connections.getLease(entry.connectionId);
			return (
				entry.active &&
				live?.generation === lease.generation &&
				live.backendId === lease.backendId &&
				live.namespaceId === lease.namespaceId &&
				live.instanceId === lease.instanceId
			);
		};
		const path = `/fwd?${new URLSearchParams({ workspaceId })}`;
		const session = new ForwardMux(
			this.connections.openSocket(entry.connectionId, path),
			current,
			() => this.close(entry.id),
		);
		entry.session = session;
		await session.ready;
		await session.probe(remotePort);
		if (!current()) throw new Error("SSH backend is disconnected");
		const server = net.createServer({ allowHalfOpen: true }, (socket) => {
			session.accept(socket, remotePort);
		});
		entry.server = server;
		await new Promise<void>((resolve, reject) => {
			server.once("error", reject);
			server.listen(0, "127.0.0.1", () => {
				server.off("error", reject);
				resolve();
			});
		});
		server.on("error", () => this.close(entry.id));
		if (!current()) {
			server.close(() => {});
			throw new Error("SSH backend is disconnected");
		}
		const address = server.address();
		if (!address || typeof address === "string")
			throw new Error("Port forward listener failed");
		return {
			id: entry.id,
			connectionId: entry.connectionId,
			localPort: address.port,
			url: `http://127.0.0.1:${address.port}`,
		};
	}
}

class ForwardMux {
	readonly ready: Promise<void>;
	private readonly streams = new Map<number, StreamState>();
	private readonly sockets = new Set<net.Socket>();
	private nextId = 1;
	private dead = false;
	private helloSeen = false;
	private flushTimer: ReturnType<typeof setTimeout> | null = null;
	private helloTimer: ReturnType<typeof setTimeout>;
	private resolveReady: () => void = () => {};
	private rejectReady: (error: Error) => void = () => {};

	constructor(
		private readonly ws: WebSocket,
		private readonly current: () => boolean,
		private readonly onClosed: () => void,
	) {
		ws.binaryType = "arraybuffer";
		this.ready = new Promise<void>((resolve, reject) => {
			this.resolveReady = resolve;
			this.rejectReady = reject;
		});
		this.ready.catch(() => {});
		this.helloTimer = setTimeout(
			() => this.close(new Error("Backend forwarding handshake timed out")),
			HANDSHAKE_TIMEOUT_MS,
		);
		this.helloTimer.unref?.();
		ws.addEventListener("message", (event) => this.receive(event.data));
		ws.addEventListener("close", () =>
			this.close(new Error("SSH port forward disconnected")),
		);
		ws.addEventListener("error", () =>
			this.close(new Error("SSH port forward failed")),
		);
	}

	async probe(port: number): Promise<void> {
		await this.open(port, null);
	}

	accept(socket: net.Socket, port: number): void {
		socket.on("error", () => socket.destroy());
		this.sockets.add(socket);
		socket.on("close", () => this.sockets.delete(socket));
		if (!this.live() || this.streams.size >= MUX_MAX_STREAMS) {
			socket.destroy();
			return;
		}
		this.open(port, socket).catch(() => socket.destroy());
	}

	close(error: Error): void {
		if (this.dead) return;
		this.dead = true;
		clearTimeout(this.helloTimer);
		if (this.flushTimer) clearTimeout(this.flushTimer);
		this.rejectReady(error);
		for (const [id, state] of this.streams) this.drop(id, state, error);
		for (const socket of this.sockets) socket.destroy();
		this.sockets.clear();
		this.ws.close();
		this.onClosed();
	}

	private live(): boolean {
		if (this.dead) return false;
		if (!this.current()) {
			this.close(new Error("SSH backend is disconnected"));
			return false;
		}
		return true;
	}

	private open(port: number, socket: net.Socket | null): Promise<void> {
		if (!this.live())
			return Promise.reject(new Error("SSH backend is disconnected"));
		if (this.nextId > 0xffffffff)
			return Promise.reject(new Error("Forward stream IDs exhausted"));
		const id = this.nextId++;
		return new Promise<void>((resolve, reject) => {
			const timer = setTimeout(() => {
				this.drop(id, state, new Error("Remote port did not answer"));
				this.send(encodeClose(id));
			}, HANDSHAKE_TIMEOUT_MS);
			timer.unref?.();
			const state: StreamState = {
				socket,
				opened: false,
				sendWindow: MUX_INITIAL_WINDOW_BYTES,
				receiveWindow: MUX_INITIAL_WINDOW_BYTES,
				queue: [],
				queuedBytes: 0,
				uncredited: 0,
				creditScheduled: false,
				localEof: false,
				remoteEof: false,
				eofSent: false,
				opening: { resolve, reject, timer },
			};
			this.streams.set(id, state);
			if (socket) {
				socket.on("data", (chunk: Buffer) => {
					if (this.streams.get(id) !== state) return;
					state.queue.push(chunk);
					state.queuedBytes += chunk.byteLength;
					if (state.queuedBytes > MAX_QUEUED_BYTES) {
						this.drop(id, state, new Error("Local forwarding queue exceeded"));
						this.send(encodeClose(id));
						return;
					}
					this.pump(id, state);
				});
				socket.on("end", () => {
					state.localEof = true;
					this.pump(id, state);
				});
				socket.on("drain", () => this.credit(id, state));
				socket.on("close", () => {
					if (this.streams.get(id) !== state) return;
					this.drop(id, state, new Error("Local connection closed"));
					this.send(encodeClose(id));
				});
			}
			this.send(encodeOpen(id, port));
		});
	}

	private receive(data: unknown): void {
		if (!this.live()) return;
		if (!(data instanceof ArrayBuffer)) {
			this.close(new Error("Invalid forwarding frame"));
			return;
		}
		if (data.byteLength > MUX_MAX_DATA_BYTES + 5) {
			this.close(new Error("Forwarding frame exceeded limit"));
			return;
		}
		const frame = decodeMuxFrame(new Uint8Array(data));
		if (!frame) {
			this.close(new Error("Invalid forwarding frame"));
			return;
		}
		if (!this.helloSeen) {
			if (
				frame.type !== MuxFrameType.hello ||
				frame.streamId !== 0 ||
				decodeHelloVersion(frame) !== MUX_PROTOCOL_VERSION
			) {
				this.close(new Error("Unsupported backend forwarding protocol"));
				return;
			}
			this.helloSeen = true;
			clearTimeout(this.helloTimer);
			this.resolveReady();
			return;
		}
		if (frame.type === MuxFrameType.ping || frame.type === MuxFrameType.pong) {
			if (frame.streamId !== 0 || frame.payload.length !== 0) {
				this.close(new Error("Invalid forwarding keepalive"));
				return;
			}
			if (frame.type === MuxFrameType.ping) this.send(encodePong());
			return;
		}
		if (
			frame.streamId === 0 ||
			frame.type === MuxFrameType.hello ||
			frame.type === MuxFrameType.open
		) {
			this.close(new Error("Invalid forwarding stream frame"));
			return;
		}
		const state = this.streams.get(frame.streamId);
		if (state) this.dispatch(frame, state);
	}

	private dispatch(frame: MuxFrame, state: StreamState): void {
		const id = frame.streamId;
		switch (frame.type) {
			case MuxFrameType.opened: {
				if (state.opened || frame.payload.length !== 0 || !state.opening) break;
				state.opened = true;
				clearTimeout(state.opening.timer);
				state.opening.resolve();
				state.opening = null;
				if (!state.socket) {
					this.streams.delete(id);
					this.send(encodeClose(id));
				} else this.pump(id, state);
				return;
			}
			case MuxFrameType.openFail: {
				if (
					state.opened ||
					frame.payload.length < 1 ||
					frame.payload.length > 1024
				)
					break;
				this.drop(id, state, new Error(decodeOpenFail(frame).message));
				return;
			}
			case MuxFrameType.data: {
				if (
					!state.opened ||
					!state.socket ||
					state.remoteEof ||
					frame.payload.length > state.receiveWindow
				)
					break;
				state.receiveWindow -= frame.payload.length;
				state.socket.write(Buffer.from(frame.payload));
				state.uncredited += frame.payload.length;
				this.credit(id, state);
				return;
			}
			case MuxFrameType.window: {
				const delta = decodeWindowDelta(frame);
				if (
					!state.opened ||
					delta === null ||
					state.sendWindow + delta > MUX_INITIAL_WINDOW_BYTES
				)
					break;
				state.sendWindow += delta;
				this.pump(id, state);
				return;
			}
			case MuxFrameType.eof: {
				if (!state.opened || state.remoteEof || frame.payload.length !== 0)
					break;
				state.remoteEof = true;
				state.socket?.end();
				return;
			}
			case MuxFrameType.close: {
				if (frame.payload.length !== 0) break;
				this.drop(id, state, new Error("Remote connection closed"), true);
				return;
			}
			default:
				break;
		}
		this.close(new Error("Invalid forwarding stream state"));
	}

	private pump(id: number, state: StreamState): void {
		if (!this.live() || this.streams.get(id) !== state) return;
		while (state.opened && state.queue.length && state.sendWindow > 0) {
			const chunk = state.queue[0];
			if (!chunk) break;
			const length = Math.min(
				chunk.length,
				state.sendWindow,
				MUX_MAX_DATA_BYTES,
			);
			if (this.ws.bufferedAmount + length + 5 > MAX_WEBSOCKET_BUFFER) {
				this.scheduleFlush();
				break;
			}
			state.queue.shift();
			if (length < chunk.length) state.queue.unshift(chunk.subarray(length));
			state.queuedBytes -= length;
			state.sendWindow -= length;
			this.send(encodeData(id, chunk.subarray(0, length)));
		}
		if (state.queuedBytes > 0 || !state.opened || state.sendWindow === 0)
			state.socket?.pause();
		else state.socket?.resume();
		if (
			state.opened &&
			state.localEof &&
			!state.eofSent &&
			state.queuedBytes === 0
		) {
			state.eofSent = true;
			this.send(encodeEof(id));
		}
	}

	private scheduleFlush(): void {
		if (this.flushTimer || this.dead) return;
		this.flushTimer = setTimeout(() => {
			this.flushTimer = null;
			for (const [id, state] of this.streams) this.pump(id, state);
		}, 10);
		this.flushTimer.unref?.();
	}

	private credit(id: number, state: StreamState): void {
		if (state.creditScheduled) return;
		state.creditScheduled = true;
		setImmediate(() => {
			state.creditScheduled = false;
			if (
				!this.live() ||
				this.streams.get(id) !== state ||
				state.socket?.writableNeedDrain
			)
				return;
			if (state.uncredited > 0) {
				const amount = state.uncredited;
				state.uncredited = 0;
				state.receiveWindow += amount;
				this.send(encodeWindow(id, amount));
			}
		});
	}

	private drop(
		id: number,
		state: StreamState,
		error: Error,
		graceful = false,
	): void {
		this.streams.delete(id);
		if (state.opening) {
			clearTimeout(state.opening.timer);
			state.opening.reject(error);
			state.opening = null;
		}
		state.queue = [];
		if (graceful && state.opened) state.socket?.destroySoon();
		else state.socket?.destroy();
	}

	private send(frame: Uint8Array<ArrayBuffer>): void {
		if (!this.live()) return;
		if (this.ws.bufferedAmount + frame.length > MAX_WEBSOCKET_BUFFER) {
			this.close(new Error("Forwarding transport queue exceeded limit"));
			return;
		}
		try {
			this.ws.send(frame);
		} catch {
			this.close(new Error("SSH port forward disconnected"));
		}
	}
}

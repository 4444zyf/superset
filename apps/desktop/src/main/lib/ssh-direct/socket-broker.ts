import type { DirectSocketEvent } from "../../../shared/direct-workstation";

interface SocketLike {
	readyState: number;
	binaryType?: string;
	addEventListener(type: string, listener: (event: { type: string; data?: unknown }) => void): void;
	send(data: string): void;
	close(): void;
}

interface OwnedSocket {
	owner: number;
	connectionId: string;
	socket: SocketLike;
}

export class SocketBroker {
	private readonly sockets = new Map<string, OwnedSocket>();
	private readonly epochs = new Map<number, number>();
	private readonly connectionEpochs = new Map<string, number>();
	private readonly pending = new Map<
		string,
		{ owner: number; connectionId: string; cancelled: boolean }
	>();

	constructor(
		private readonly openSocket: (
			connectionId: string,
			path: string,
		) => SocketLike | Promise<SocketLike>,
	) {}

	async open(
		owner: number,
		socketId: string,
		connectionId: string,
		path: string,
		emit: (event: DirectSocketEvent) => void,
	): Promise<void> {
		if (
			!/^[a-zA-Z0-9-]{1,100}$/.test(socketId) ||
			this.sockets.has(socketId) ||
			this.pending.has(socketId)
		)
			throw new Error("Socket ID is already in use or invalid");
		if (
			[...this.sockets.values(), ...this.pending.values()].filter(
				(entry) => entry.owner === owner,
			).length >= 64
		)
			throw new Error("Too many workstation sockets");
		if (
			!/^\/terminal\/[a-zA-Z0-9-]+(?:\?seq=[0-9]+)?$/.test(path) &&
			!/^\/terminal-restore\/[a-zA-Z0-9_-]+\?workspaceId=[a-zA-Z0-9_-]+&executionId=[a-zA-Z0-9_-]+$/.test(path) &&
			!/^\/chat-v3\/sessions\/[a-zA-Z0-9-]+\/stream(?:\?since=[a-zA-Z0-9:%._-]+(?:&deltas=text,terminal)?)?$/.test(
				path,
			)
		)
			throw new Error("Unsupported workstation socket");
		const epoch = this.epochs.get(owner) ?? 0;
		const connectionEpoch = this.connectionEpochs.get(connectionId) ?? 0;
		const pending = { owner, connectionId, cancelled: false };
		this.pending.set(socketId, pending);
		let socket: SocketLike;
		try {
			socket = await this.openSocket(connectionId, path);
		} finally {
			this.pending.delete(socketId);
		}
		if (
			pending.cancelled ||
			(this.epochs.get(owner) ?? 0) !== epoch ||
			(this.connectionEpochs.get(connectionId) ?? 0) !== connectionEpoch
		) {
			socket.close();
			return;
		}
		socket.binaryType = "arraybuffer";
		this.sockets.set(socketId, { owner, connectionId, socket });
		const current = () => this.sockets.get(socketId)?.socket === socket;
		socket.addEventListener("open", () => {
			if (current()) emit({ socketId, kind: "open" });
		});
		socket.addEventListener("message", (event) => {
			if (!current()) return;
			const value: unknown = event.data;
			const data =
				value instanceof ArrayBuffer
					? new Uint8Array(value)
					: value instanceof Uint8Array
						? value
						: typeof value === "string"
							? value
							: undefined;
			if (data !== undefined) emit({ socketId, kind: "message", data });
		});
		socket.addEventListener("close", () => {
			if (current()) {
				this.sockets.delete(socketId);
				emit({ socketId, kind: "close" });
			}
		});
		socket.addEventListener("error", () => {
			if (current()) emit({ socketId, kind: "error" });
		});
		if (socket.readyState === 1) emit({ socketId, kind: "open" });
	}

	send(owner: number, socketId: string, data: string): void {
		const { socket } = this.owned(owner, socketId);
		if (typeof data !== "string" || data.length > 1024 * 1024)
			throw new Error("Invalid socket payload");
		if (socket.readyState !== 1) throw new Error("Socket is disconnected");
		socket.send(data);
	}

	close(owner: number, socketId: string): void {
		const entry = this.sockets.get(socketId);
		const pending = this.pending.get(socketId);
		if (
			(entry && entry.owner !== owner) ||
			(pending && pending.owner !== owner)
		)
			throw new Error("Socket does not belong to this window");
		if (pending) pending.cancelled = true;
		if (!entry) return;
		this.sockets.delete(socketId);
		entry.socket.close();
	}

	closeOwner(owner: number): void {
		this.epochs.set(owner, (this.epochs.get(owner) ?? 0) + 1);
		for (const [id, entry] of this.sockets)
			if (entry.owner === owner) this.close(owner, id);
	}

	closeConnection(connectionId: string): void {
		this.connectionEpochs.set(
			connectionId,
			(this.connectionEpochs.get(connectionId) ?? 0) + 1,
		);
		for (const [id, entry] of this.sockets)
			if (entry.connectionId === connectionId) this.close(entry.owner, id);
	}

	private owned(owner: number, socketId: string): OwnedSocket {
		const entry = this.sockets.get(socketId);
		if (!entry || entry.owner !== owner)
			throw new Error("Socket does not belong to this window");
		return entry;
	}
}

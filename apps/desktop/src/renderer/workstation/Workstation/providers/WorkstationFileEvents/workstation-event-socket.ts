import type { EventBusSocket } from "@superset/workspace-client/event-bus-core";
import type {
	DirectDescriptor,
	DirectSocketEvent,
	DirectWorkstationApi,
} from "../../../../../shared/direct-workstation";

type Schedule = (callback: () => void, delay: number) => () => void;
export class WorkstationEventSocket implements EventBusSocket {
	readyState = 0;
	shouldReconnect = true;
	private readonly events = new EventTarget();
	private readonly unsubscribe: () => void;
	private socketId: string | null = null;
	private cancelRetry: (() => void) | null = null;
	private retries = 0;
	constructor(
		private readonly api: Pick<
			DirectWorkstationApi,
			"openSocket" | "sendSocket" | "closeSocket" | "onSocket"
		>,
		private readonly connection: DirectDescriptor,
		private readonly schedule: Schedule = (callback, delay) => {
			const timer = setTimeout(callback, delay);
			return () => clearTimeout(timer);
		},
	) {
		this.unsubscribe = api.onSocket((event) => this.receive(event));
		queueMicrotask(() => this.connect());
	}
	addEventListener(type: "open" | "close", listener: () => void): void;
	addEventListener(
		type: "message",
		listener: (event: { data: unknown }) => void,
	): void;
	addEventListener(
		type: string,
		listener: (() => void) | ((event: { data: unknown }) => void),
	): void {
		this.events.addEventListener(type, listener as EventListener);
	}
	private connect(): void {
		if (!this.shouldReconnect) return;
		this.cancelRetry?.();
		this.cancelRetry = null;
		this.readyState = 0;
		const socketId = crypto.randomUUID();
		this.socketId = socketId;
		void this.api.openSocket(this.connection, "/events", socketId).catch(() => {
			if (this.socketId === socketId) this.drop();
		});
	}
	private receive(event: DirectSocketEvent): void {
		if (event.socketId !== this.socketId || !this.shouldReconnect) return;
		if (event.kind === "open") {
			this.readyState = 1;
			this.retries = 0;
			this.events.dispatchEvent(new Event("open"));
		} else if (event.kind === "message") {
			if (
				typeof event.data !== "string" ||
				event.data.length > 1024 * 1024 ||
				new TextEncoder().encode(event.data).byteLength > 1024 * 1024
			) {
				this.drop();
				return;
			}
			let message: { type?: string; code?: string } | null = null;
			try {
				message = JSON.parse(event.data);
			} catch {}
			if (message?.type === "error" && message.code !== "git-watch-cap") {
				this.drop();
				return;
			}
			this.events.dispatchEvent(
				new MessageEvent("message", { data: event.data }),
			);
		} else this.drop();
	}
	private drop(): void {
		const id = this.socketId;
		this.socketId = null;
		if (id) void this.api.closeSocket(id).catch(() => {});
		this.readyState = 3;
		this.events.dispatchEvent(new Event("close"));
		if (this.shouldReconnect && !this.cancelRetry) {
			const delay = Math.min(1000 * 2 ** this.retries, 5000);
			this.retries = Math.min(this.retries + 1, 3);
			this.cancelRetry = this.schedule(() => {
				this.cancelRetry = null;
				this.connect();
			}, delay);
		}
	}
	send(data: string): void {
		const id = this.socketId;
		if (this.readyState !== 1 || !id) return;
		void this.api.sendSocket(id, data).catch(() => {
			if (this.socketId === id) this.drop();
		});
	}
	reconnect(): void {
		if (!this.shouldReconnect) return;
		this.cancelRetry?.();
		this.cancelRetry = null;
		const id = this.socketId;
		this.socketId = null;
		if (id) void this.api.closeSocket(id).catch(() => {});
		this.readyState = 0;
		this.events.dispatchEvent(new Event("close"));
		this.connect();
	}
	close(): void {
		this.shouldReconnect = false;
		this.cancelRetry?.();
		this.cancelRetry = null;
		this.unsubscribe();
		this.drop();
	}
}

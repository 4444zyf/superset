import { randomUUID } from "node:crypto";
import {
	browserBridgeConsoleResultSchema,
	browserBridgeIdentitySchema,
	browserBridgeListResultSchema,
	browserBridgeReadOperationSchema,
	encodeBrowserBridgePacket,
	parseBrowserBridgePacket,
	type BrowserBridgeIdentity,
	type BrowserBridgeReadOperation,
	type BrowserBridgeListResult,
	type BrowserBridgeConsoleResult,
	type BrowserBridgePacket,
} from "@superset/shared/browser-bridge";

type FailureKind = "unavailable" | "busy" | "timeout" | "invalid" | "failed";
export class DirectBrowserBridgeError extends Error {
	constructor(
		readonly kind: FailureKind,
		message: string,
	) {
		super(message);
		this.name = "DirectBrowserBridgeError";
	}
}
export interface DirectBrowserReadTransport {
	send(raw: string): void;
	close(code: number, reason: string): void;
}
interface Peer {
	transport: DirectBrowserReadTransport;
	ready: boolean;
	cancelHandshake(): void;
}
type ReadResult = BrowserBridgeListResult | BrowserBridgeConsoleResult;
interface Pending {
	operation: BrowserBridgeReadOperation;
	resolve(value: ReadResult): void;
	reject(error: DirectBrowserBridgeError): void;
	cancel(): void;
}
function schedule(milliseconds: number, callback: () => void): () => void {
	const timer = setTimeout(callback, milliseconds);
	timer.unref?.();
	return () => clearTimeout(timer);
}

export class DirectBrowserReadBridge {
	private readonly identity: BrowserBridgeIdentity;
	private readonly pending = new Map<string, Pending>();
	private peer: Peer | null = null;
	private disposed = false;
	private readonly schedule: typeof schedule;
	constructor(
		identity: BrowserBridgeIdentity,
		options: { schedule?: typeof schedule } = {},
	) {
		this.identity = browserBridgeIdentitySchema.parse(identity);
		this.schedule = options.schedule ?? schedule;
	}
	isReady(): boolean {
		return !this.disposed && this.peer?.ready === true;
	}
	attach(transport: DirectBrowserReadTransport) {
		if (this.disposed)
			throw new DirectBrowserBridgeError(
				"unavailable",
				"Browser bridge is unavailable",
			);
		if (this.peer)
			throw new DirectBrowserBridgeError(
				"busy",
				"A browser bridge is already attached",
			);
		const peer: Peer = { transport, ready: false, cancelHandshake: () => {} };
		this.peer = peer;
		peer.cancelHandshake = this.schedule(5_000, () =>
			this.drop(
				peer,
				new DirectBrowserBridgeError(
					"timeout",
					"Browser bridge handshake timed out",
				),
				1008,
			),
		);
		return {
			receive: (raw: string) => this.receive(peer, raw),
			close: () =>
				this.drop(
					peer,
					new DirectBrowserBridgeError(
						"unavailable",
						"Browser bridge disconnected",
					),
					1000,
				),
		};
	}
	private drop(
		peer: Peer,
		error: DirectBrowserBridgeError,
		code: number,
	): void {
		if (this.peer !== peer) return;
		this.peer = null;
		peer.cancelHandshake();
		const pending = [...this.pending.values()];
		this.pending.clear();
		for (const operation of pending) {
			operation.cancel();
			operation.reject(error);
		}
		try {
			peer.transport.close(code, error.message);
		} catch {}
	}
	private receive(peer: Peer, raw: string): void {
		if (this.peer !== peer) return;
		try {
			const packet = parseBrowserBridgePacket(raw);
			if (!peer.ready) {
				if (
					packet.type !== "hello" ||
					packet.backendId !== this.identity.backendId ||
					packet.namespaceId !== this.identity.namespaceId ||
					packet.instanceId !== this.identity.instanceId ||
					!packet.features.includes("readV1")
				)
					throw Error("Invalid bridge handshake");
				peer.cancelHandshake();
				peer.ready = true;
				this.send(peer, {
					type: "ready",
					protocol: 1,
					...this.identity,
					features: ["readV1"],
				});
				return;
			}
			if (packet.type !== "result") throw Error("Invalid bridge response");
			const pending = this.pending.get(packet.id);
			if (!pending) return;
			if (!packet.ok) {
				this.pending.delete(packet.id);
				pending.cancel();
				pending.reject(
					new DirectBrowserBridgeError("failed", packet.error.message),
				);
				return;
			}
			let value: ReadResult;
			if (pending.operation.type === "list") {
				const result = browserBridgeListResultSchema.parse(packet.value);
				if (
					result.panes.some(
						(pane) => pane.workspaceId !== pending.operation.workspaceId,
					)
				)
					throw Error("Foreign workspace response");
				value = result;
			} else value = browserBridgeConsoleResultSchema.parse(packet.value);
			this.pending.delete(packet.id);
			pending.cancel();
			pending.resolve(value);
		} catch {
			this.drop(
				peer,
				new DirectBrowserBridgeError(
					"invalid",
					"Invalid browser bridge response",
				),
				1008,
			);
		}
	}
	private send(peer: Peer, packet: BrowserBridgePacket): void {
		try {
			peer.transport.send(encodeBrowserBridgePacket(packet));
		} catch {
			this.drop(
				peer,
				new DirectBrowserBridgeError(
					"unavailable",
					"Browser bridge transport failed",
				),
				1011,
			);
		}
	}
	private read(
		operation: Extract<BrowserBridgeReadOperation, { type: "list" }>,
	): Promise<BrowserBridgeListResult>;
	private read(
		operation: Extract<BrowserBridgeReadOperation, { type: "console" }>,
	): Promise<BrowserBridgeConsoleResult>;
	private read(operation: BrowserBridgeReadOperation): Promise<ReadResult> {
		const peer = this.peer;
		if (!this.isReady() || !peer)
			return Promise.reject(
				new DirectBrowserBridgeError(
					"unavailable",
					"Browser bridge is unavailable",
				),
			);
		const parsed = browserBridgeReadOperationSchema.safeParse(operation);
		if (!parsed.success)
			return Promise.reject(
				new DirectBrowserBridgeError("invalid", "Invalid browser bridge read"),
			);
		if (this.pending.size >= 8)
			return Promise.reject(
				new DirectBrowserBridgeError("busy", "Too many pending browser reads"),
			);
		return new Promise<ReadResult>((resolve, reject) => {
			const id = randomUUID();
			const pending: Pending = {
				operation: parsed.data,
				resolve,
				reject,
				cancel: () => {},
			};
			this.pending.set(id, pending);
			pending.cancel = this.schedule(10_000, () => {
				if (this.pending.get(id) !== pending) return;
				this.pending.delete(id);
				pending.cancel();
				reject(
					new DirectBrowserBridgeError(
						"timeout",
						"Browser bridge read timed out",
					),
				);
			});
			this.send(peer, { type: "request", id, operation: parsed.data });
		});
	}
	listPanes(workspaceId: string): Promise<BrowserBridgeListResult> {
		return this.read({ type: "list", workspaceId });
	}
	console(
		workspaceId: string,
		paneId: string,
	): Promise<BrowserBridgeConsoleResult> {
		return this.read({ type: "console", workspaceId, paneId });
	}
	dispose(): void {
		this.disposed = true;
		if (this.peer)
			this.drop(
				this.peer,
				new DirectBrowserBridgeError(
					"unavailable",
					"Browser bridge is unavailable",
				),
				1000,
			);
	}
}

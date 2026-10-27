import { randomUUID } from "node:crypto";
import {
	assertBrowserCdpRaw,
	BROWSER_CDP_ACK_TIMEOUT_MS,
	BROWSER_CDP_MAX_RAW_BYTES,
	type BrowserCdpPacket,
	browserCdpPacketSchema,
} from "@superset/shared/browser-cdp-bridge";

interface Client {
	send(raw: string): void;
	close(code: number, reason: string): void;
}
interface Target {
	current(): boolean;
	send(packet: BrowserCdpPacket): void;
	invalidate(): void;
}
interface Entry {
	id: string;
	target: Target;
	client: Client;
	ready: boolean;
	queued: string[];
	queuedBytes: number;
	cancel(): void;
}

export class BrowserCdpTransferError extends Error {
	constructor(
		readonly kind: "unavailable" | "busy",
		message: string,
	) {
		super(message);
		this.name = "BrowserCdpTransferError";
	}
}

export class BrowserCdpTransfer {
	private readonly entries = new Map<string, Entry>();
	constructor(
		private readonly options: {
			schedule(milliseconds: number, callback: () => void): () => void;
		},
	) {}
	connect(
		input: { workspaceId: string; paneId: string },
		client: Client,
		target: Target,
	) {
		if (!target.current())
			throw new BrowserCdpTransferError(
				"unavailable",
				"Browser CDP peer is unavailable",
			);
		if (this.entries.size >= 16)
			throw new BrowserCdpTransferError(
				"busy",
				"Browser CDP sessions are busy",
			);
		const packet = browserCdpPacketSchema.parse({
			type: "cdp-open",
			sessionId: randomUUID(),
			workspaceId: input.workspaceId,
			paneId: input.paneId,
		});
		const entry: Entry = {
			id: packet.sessionId,
			target,
			client,
			ready: false,
			queued: [],
			queuedBytes: 0,
			cancel: () => {},
		};
		this.entries.set(entry.id, entry);
		entry.cancel = this.options.schedule(BROWSER_CDP_ACK_TIMEOUT_MS, () => {
			if (this.entries.get(entry.id) !== entry || entry.ready) return;
			this.invalidate(entry);
		});
		this.send(entry, packet);
		return {
			close: () => this.close(entry, 1000, true),
			receive: (raw: string) => {
				if (!this.current(entry)) return;
				try {
					assertBrowserCdpRaw(raw);
				} catch {
					this.close(entry, 1009, true);
					return;
				}
				if (!entry.ready) {
					entry.queuedBytes += new TextEncoder().encode(raw).byteLength;
					if (
						entry.queued.length >= 64 ||
						entry.queuedBytes > BROWSER_CDP_MAX_RAW_BYTES
					) {
						this.close(entry, 1009, true);
						return;
					}
					entry.queued.push(raw);
					return;
				}
				this.send(entry, { type: "cdp-message", sessionId: entry.id, raw });
			},
		};
	}
	disconnect(): void {
		for (const entry of [...this.entries.values()])
			this.close(entry, 1011, false);
	}
	receive(packet: BrowserCdpPacket): void {
		if (packet.type === "cdp-open") throw Error("Invalid CDP bridge direction");
		const entry = this.entries.get(packet.sessionId);
		if (!entry || !this.current(entry)) return;
		if (packet.type === "cdp-close") {
			this.close(entry, packet.code, false);
			return;
		}
		if (packet.type === "cdp-open-result") {
			if (entry.ready) throw Error("Duplicate CDP open acknowledgement");
			if (!packet.ok) {
				this.close(entry, packet.code, false);
				return;
			}
			entry.ready = true;
			entry.cancel();
			const queued = entry.queued;
			entry.queued = [];
			entry.queuedBytes = 0;
			for (const raw of queued)
				this.send(entry, { type: "cdp-message", sessionId: entry.id, raw });
			return;
		}
		try {
			assertBrowserCdpRaw(packet.raw);
			entry.client.send(packet.raw);
		} catch {
			this.close(entry, 1011, true);
		}
	}
	private current(entry: Entry): boolean {
		if (this.entries.get(entry.id) !== entry) return false;
		if (entry.target.current()) return true;
		this.close(entry, 1011, false);
		return false;
	}
	private send(entry: Entry, packet: BrowserCdpPacket): void {
		if (!this.current(entry)) return;
		try {
			entry.target.send(packet);
		} catch {
			this.invalidate(entry);
		}
	}
	private invalidate(entry: Entry): void {
		const captured = [...this.entries.values()];
		try {
			entry.target.invalidate();
		} catch {}
		for (const session of captured) this.close(session, 1011, false);
	}
	private close(entry: Entry, code: number, notifyMain: boolean): void {
		if (this.entries.get(entry.id) !== entry) return;
		this.entries.delete(entry.id);
		entry.cancel();
		entry.queued = [];
		entry.queuedBytes = 0;
		if (notifyMain && entry.target.current()) {
			try {
				entry.target.send({
					type: "cdp-close",
					sessionId: entry.id,
					code: 1000,
				});
			} catch {
				this.invalidate(entry);
			}
		}
		try {
			entry.client.close(code, "Browser CDP connection closed");
		} catch {}
	}
}

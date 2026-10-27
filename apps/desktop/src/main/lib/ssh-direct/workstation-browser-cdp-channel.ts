import {
	assertBrowserCdpRaw,
	BROWSER_CDP_MAX_RESPONSE_BYTES,
	type BrowserCdpPacket,
} from "@superset/shared/browser-cdp-bridge";
import type { CdpSession } from "../browser/browser-manager";
import type { PinnedWorkstationBrowserCdp } from "./workstation-browser-cdp-sessions";

interface Entry {
	id: string;
	pinned: PinnedWorkstationBrowserCdp | null;
	session: CdpSession | null;
}

export class WorkstationBrowserCdpChannel {
	private readonly entries = new Map<string, Entry>();
	private closed = false;
	constructor(
		private readonly dependencies: {
			current(): boolean;
			invalidate(): void;
			send(packet: BrowserCdpPacket): void;
			isBusy(error: unknown): boolean;
			pin(input: {
				workspaceId: string;
				paneId: string;
			}): PinnedWorkstationBrowserCdp;
		},
	) {}
	receive(packet: BrowserCdpPacket): void {
		if (!this.available()) return;
		if (packet.type === "cdp-output" || packet.type === "cdp-open-result")
			throw Error("Invalid Main CDP bridge direction");
		if (packet.type === "cdp-open") {
			this.open(packet);
			return;
		}
		const entry = this.entries.get(packet.sessionId);
		if (!entry) return;
		if (packet.type === "cdp-close") {
			this.remove(entry);
			return;
		}
		if (!entry.session) {
			this.finish(entry, 1008);
			return;
		}
		try {
			assertBrowserCdpRaw(packet.raw);
		} catch {
			this.finish(entry, 1009);
			return;
		}
		try {
			entry.session.send(packet.raw);
		} catch {
			this.finish(entry, 1011);
		}
	}
	closeAll(): void {
		this.closed = true;
		for (const entry of [...this.entries.values()]) this.remove(entry);
	}
	private available(): boolean {
		if (this.closed) return false;
		if (this.dependencies.current()) return true;
		this.invalidate();
		return false;
	}
	private invalidate(): void {
		this.closeAll();
		try {
			this.dependencies.invalidate();
		} catch {}
	}
	private wire(packet: BrowserCdpPacket): void {
		if (!this.available()) return;
		try {
			this.dependencies.send(packet);
		} catch {
			this.invalidate();
		}
	}
	private remove(entry: Entry): boolean {
		if (this.entries.get(entry.id) !== entry) return false;
		this.entries.delete(entry.id);
		try {
			entry.pinned?.release();
		} catch {}
		return true;
	}
	private finish(entry: Entry, code: 1008 | 1009 | 1011): void {
		if (this.remove(entry))
			this.wire({ type: "cdp-close", sessionId: entry.id, code });
	}
	private open(packet: Extract<BrowserCdpPacket, { type: "cdp-open" }>): void {
		if (this.entries.has(packet.sessionId))
			throw Error("Duplicate Main CDP session");
		if (this.entries.size >= 16) {
			this.wire({
				type: "cdp-open-result",
				sessionId: packet.sessionId,
				ok: false,
				code: 1013,
			});
			return;
		}
		const entry: Entry = { id: packet.sessionId, pinned: null, session: null };
		this.entries.set(entry.id, entry);
		try {
			entry.pinned = this.dependencies.pin({
				workspaceId: packet.workspaceId,
				paneId: packet.paneId,
			});
			const session = entry.pinned.open({
				onMessage: (raw) => {
					if (this.entries.get(entry.id) !== entry || !this.available()) return;
					try {
						assertBrowserCdpRaw(raw, BROWSER_CDP_MAX_RESPONSE_BYTES);
					} catch {
						this.finish(entry, 1009);
						return;
					}
					this.wire({ type: "cdp-output", sessionId: entry.id, raw });
				},
				onDetach: () => this.finish(entry, 1011),
			});
			if (this.entries.get(entry.id) !== entry || !this.available()) return;
			entry.session = session;
			this.wire({ type: "cdp-open-result", sessionId: entry.id, ok: true });
		} catch (error) {
			if (!this.remove(entry)) return;
			this.wire({
				type: "cdp-open-result",
				sessionId: entry.id,
				ok: false,
				code: this.dependencies.isBusy(error) ? 1013 : 1011,
			});
		}
	}
}

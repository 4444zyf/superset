import {
	browserBridgeConsoleResultSchema,
	browserBridgeListResultSchema,
	encodeBrowserBridgePacket,
	parseBrowserBridgePacket,
	type BrowserBridgeReadOperation,
} from "@superset/shared/browser-bridge";
import type { DirectDescriptor } from "../../../shared/direct-workstation";
import type { currentWorkstationBrowserBridgePanes } from "./workstation-browser-bridge-panes";

export interface BrowserReadTarget {
	ownerId: number;
	ownerEpoch: number;
	descriptor: DirectDescriptor;
}
type Socket = Pick<WebSocket, "addEventListener" | "send" | "close">;
interface Entry {
	target: BrowserReadTarget;
	socket: Socket;
	ready: boolean;
	closing: boolean;
	next: BrowserReadTarget | null;
	pending: Set<string>;
}
function same(a: BrowserReadTarget, b: BrowserReadTarget): boolean {
	return (
		a.ownerId === b.ownerId &&
		a.ownerEpoch === b.ownerEpoch &&
		a.descriptor.connectionId === b.descriptor.connectionId &&
		a.descriptor.generation === b.descriptor.generation &&
		a.descriptor.backendId === b.descriptor.backendId &&
		a.descriptor.namespaceId === b.descriptor.namespaceId &&
		a.descriptor.instanceId === b.descriptor.instanceId
	);
}

export class WorkstationBrowserReadChannels {
	private readonly entries = new Map<string, Entry>();
	constructor(
		private readonly dependencies: {
			getTarget(id: string): BrowserReadTarget | null;
			openSocket(id: string, path: string): Socket;
			panes(
				target: BrowserReadTarget,
				isCurrent: () => boolean,
			): Pick<
				ReturnType<typeof currentWorkstationBrowserBridgePanes>,
				"listPanes" | "getConsoleLogs"
			>;
		},
	) {}
	private target(id: string): BrowserReadTarget | null {
		try {
			const target = this.dependencies.getTarget(id);
			return target
				? { ...target, descriptor: { ...target.descriptor } }
				: null;
		} catch {
			return null;
		}
	}
	sync(id: string): void {
		const target = this.target(id),
			entry = this.entries.get(id);
		if (entry) {
			if (target && !entry.closing && same(entry.target, target)) return;
			entry.next = target;
			this.close(entry);
		} else if (target) this.open(target);
	}
	closeAll(): void {
		for (const entry of this.entries.values()) {
			entry.next = null;
			this.close(entry);
		}
	}
	private close(entry: Entry, code = 1000): void {
		if (entry.closing) return;
		entry.closing = true;
		try {
			entry.socket.close(code, "Browser read channel closed");
		} catch {}
	}
	private current(entry: Entry): boolean {
		if (
			entry.closing ||
			this.entries.get(entry.target.descriptor.connectionId) !== entry
		)
			return false;
		const target = this.target(entry.target.descriptor.connectionId);
		return target !== null && same(target, entry.target);
	}
	private open(target: BrowserReadTarget): void {
		const id = target.descriptor.connectionId;
		let socket: Socket;
		try {
			socket = this.dependencies.openSocket(id, "/direct/browser-read/v1");
		} catch {
			return;
		}
		const entry: Entry = {
			target,
			socket,
			ready: false,
			closing: false,
			next: null,
			pending: new Set(),
		};
		this.entries.set(id, entry);
		socket.addEventListener("close", () => {
			if (this.entries.get(id) !== entry) return;
			this.entries.delete(id);
			const next = entry.next,
				latest = this.target(id);
			if (next && latest && same(next, latest)) this.open(next);
		});
		socket.addEventListener("error", () => {
			if (entry.closing) return;
			entry.next = null;
			this.close(entry, 1011);
		});
		socket.addEventListener("open", () => {
			if (!this.current(entry)) {
				this.close(entry);
				return;
			}
			try {
				socket.send(
					encodeBrowserBridgePacket({
						type: "hello",
						protocol: 1,
						backendId: target.descriptor.backendId,
						namespaceId: target.descriptor.namespaceId,
						instanceId: target.descriptor.instanceId,
						features: ["readV1"],
					}),
				);
			} catch {
				this.close(entry, 1011);
			}
		});
		socket.addEventListener("message", (event) => {
			if (!this.current(entry)) {
				this.close(entry);
				return;
			}
			try {
				if (typeof event.data !== "string") throw Error("Expected text");
				const packet = parseBrowserBridgePacket(event.data);
				if (!entry.ready) {
					if (
						packet.type !== "ready" ||
						packet.backendId !== target.descriptor.backendId ||
						packet.namespaceId !== target.descriptor.namespaceId ||
						packet.instanceId !== target.descriptor.instanceId ||
						!packet.features.includes("readV1")
					)
						throw Error("Invalid ready");
					entry.ready = true;
					return;
				}
				if (
					packet.type !== "request" ||
					entry.pending.has(packet.id) ||
					entry.pending.size >= 8
				)
					throw Error("Invalid request");
				entry.pending.add(packet.id);
				void this.read(entry, packet.id, packet.operation).catch(() =>
					this.close(entry, 1011),
				);
			} catch {
				this.close(entry, 1008);
			}
		});
	}
	private async read(
		entry: Entry,
		id: string,
		operation: BrowserBridgeReadOperation,
	): Promise<void> {
		try {
			if (!this.current(entry)) {
				this.close(entry);
				return;
			}
			const panes = this.dependencies.panes(entry.target, () =>
				this.current(entry),
			);
			const value =
				operation.type === "list"
					? browserBridgeListResultSchema.parse({
							panes: panes.listPanes(operation.workspaceId),
						})
					: browserBridgeConsoleResultSchema.parse({
							entries: panes.getConsoleLogs(
								operation.paneId,
								operation.workspaceId,
							),
						});
			if (!this.current(entry)) {
				this.close(entry);
				return;
			}
			entry.socket.send(
				encodeBrowserBridgePacket({ type: "result", id, ok: true, value }),
			);
		} catch {
			if (!this.current(entry)) {
				this.close(entry);
				return;
			}
			entry.socket.send(
				encodeBrowserBridgePacket({
					type: "result",
					id,
					ok: false,
					error: {
						message: "Browser read failed or pane is no longer current",
					},
				}),
			);
		} finally {
			entry.pending.delete(id);
		}
	}
}

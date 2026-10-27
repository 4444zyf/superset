import type { WebContents } from "electron";
import type { CdpSession } from "../browser/browser-manager";
import type { BrowserReadTarget } from "./workstation-browser-read-channel";
import type { WorkstationBrowserRegistry } from "./workstation-browser-registry";

interface Listeners {
	onMessage(raw: string): void;
	onDetach(reason: string): void;
}
export interface PinnedWorkstationBrowserCdp {
	open(listeners: Listeners): CdpSession;
	release(): void;
}

export class WorkstationBrowserCdpSessions {
	constructor(
		private readonly dependencies: {
			registry(): Pick<
				WorkstationBrowserRegistry,
				"listRegistrations" | "getManagerPaneId"
			> | null;
			manager: {
				getWebContents(
					key: string,
					workspaceId: string,
				): Pick<WebContents, "isDestroyed"> | null;
				attachCdp(
					key: string,
					workspaceId: string,
					onMessage: (raw: string) => void,
					onDetach: (reason: string) => void,
				): CdpSession;
			};
		},
	) {}

	pin(
		target: BrowserReadTarget,
		request: { workspaceId: string; paneId: string },
		isCurrent: () => boolean,
	): PinnedWorkstationBrowserCdp {
		const unavailable = () => Error("Browser CDP target is no longer current");
		if (!isCurrent()) throw unavailable();
		const registry = this.dependencies.registry();
		if (!registry) throw unavailable();
		const ownerId = target.ownerId,
			descriptor = { ...target.descriptor };
		const registration = registry
			.listRegistrations(ownerId, descriptor, request.workspaceId)
			.find((pane) => pane.paneId === request.paneId);
		if (!registration) throw Error("Browser CDP pane is no longer available");
		const pane = { ...registration },
			key = registry.getManagerPaneId(ownerId, pane);
		if (!key) throw unavailable();
		const guest = this.dependencies.manager.getWebContents(
			key,
			pane.workspaceId,
		);
		if (!guest || guest.isDestroyed()) throw unavailable();
		const current = () => {
			try {
				return (
					isCurrent() &&
					this.dependencies.registry() === registry &&
					registry.getManagerPaneId(ownerId, pane) === key &&
					this.dependencies.manager.getWebContents(key, pane.workspaceId) ===
						guest &&
					!guest.isDestroyed()
				);
			} catch {
				return false;
			}
		};
		if (!current()) throw unavailable();
		let started = false,
			closed = false,
			nativeDetached = false,
			handle: CdpSession | null = null,
			listeners: Listeners | null = null;
		const notify = (reason: string) => {
			try {
				listeners?.onDetach(reason);
			} catch {}
		};
		const close = (reason?: string) => {
			if (closed) return;
			closed = true;
			const captured = handle;
			handle = null;
			try {
				captured?.detach();
			} catch {}
			if (reason) notify(reason);
		};
		return {
			release: () => close(),
			open: (callbacks) => {
				if (started || closed) throw unavailable();
				started = true;
				if (!current()) {
					closed = true;
					throw unavailable();
				}
				listeners = callbacks;
				let attached: CdpSession;
				try {
					attached = this.dependencies.manager.attachCdp(
						key,
						pane.workspaceId,
						(raw) => {
							if (closed) return;
							if (!current()) {
								close("Browser CDP scope changed");
								return;
							}
							try {
								callbacks.onMessage(raw);
							} catch {
								close("Browser CDP transport closed");
							}
						},
						(reason) => {
							if (closed) return;
							nativeDetached = true;
							closed = true;
							handle = null;
							notify(reason);
						},
					);
				} catch (error) {
					closed = true;
					throw error;
				}
				if (closed || !current()) {
					closed = true;
					if (!nativeDetached) {
						try {
							attached.detach();
						} catch {}
					}
					throw unavailable();
				}
				handle = attached;
				return {
					detach: () => close(),
					send: (raw) => {
						if (closed) return;
						if (!current()) {
							close("Browser CDP scope changed");
							return;
						}
						try {
							handle?.send(raw);
						} catch (error) {
							close("Browser CDP transport closed");
							throw error;
						}
					},
				};
			},
		};
	}
}

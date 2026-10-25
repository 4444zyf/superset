import type { EventEmitter } from "node:events";
import type { DirectDescriptor } from "../../../shared/direct-workstation";
import {
	forwardedTerminalUrl,
	terminalUrlTarget,
} from "../../../shared/terminal-url-target";
import type {
	WorkstationBrowserEvent,
	WorkstationBrowserPane,
	WorkstationBrowserNavigationResult,
} from "../../../shared/workstation-browser";

interface Guest extends Pick<EventEmitter, "on" | "off"> {
	isDestroyed(): boolean;
	loadURL(url: string): Promise<void>;
}

interface Navigation {
	owner: number;
	pane: WorkstationBrowserPane;
	descriptor: DirectDescriptor;
	guest: Guest;
	current(): boolean;
	sequence: number;
	origins: Map<string, string>;
}

export class WorkstationBrowserNavigation {
	private readonly entries = new Map<string, Navigation>();
	constructor(
		private readonly dependencies: {
			isLocal(connectionId: string): boolean;
			prepare(
				descriptor: DirectDescriptor,
				workspaceId: string,
				port: number,
			): Promise<{ url: string }>;
			send(owner: number, event: WorkstationBrowserEvent): void;
		},
	) {}
	private key(owner: number, pane: WorkstationBrowserPane): string {
		return JSON.stringify([
			owner,
			pane.connectionId,
			pane.generation,
			pane.workspaceId,
			pane.paneId,
			pane.registrationId,
		]);
	}
	bind(
		owner: number,
		pane: WorkstationBrowserPane,
		descriptor: DirectDescriptor,
		guest: Guest,
		current: () => boolean,
	): () => void {
		const key = this.key(owner, pane);
		const entry: Navigation = {
			owner,
			pane: { ...pane },
			descriptor: { ...descriptor },
			guest,
			current,
			sequence: 0,
			origins: new Map(),
		};
		this.entries.set(key, entry);
		const intercept = (
			event: { preventDefault(): void },
			url: string,
			_inPlace?: boolean,
			mainFrame?: boolean,
		) => {
			if (mainFrame === false) return;
			if (!this.active(key, entry)) {
				event.preventDefault();
				return;
			}
			const target = terminalUrlTarget(
				url,
				this.dependencies.isLocal(pane.connectionId),
			);
			if (target?.kind !== "forward" || entry.origins.has(new URL(url).origin))
				return;
			event.preventDefault();
			void this.navigate(owner, pane, url).catch((error: unknown) => {
				if (this.active(key, entry))
					this.dependencies.send(owner, {
						...pane,
						type: "navigation-error",
						message: error instanceof Error ? error.message : String(error),
					});
			});
		};
		guest.on("will-navigate", intercept);
		guest.on("will-redirect", intercept);
		const find = (
			event: { preventDefault(): void },
			input: {
				type: string;
				key: string;
				control: boolean;
				meta: boolean;
				alt: boolean;
				shift: boolean;
			},
		) => {
			if (
				this.active(key, entry) &&
				input.type === "keyDown" &&
				(input.control || input.meta) &&
				!input.alt &&
				!input.shift &&
				input.key.toLowerCase() === "f"
			) {
				event.preventDefault();
				this.dependencies.send(owner, {
					...pane,
					type: "context-menu-action",
					action: "find",
					url: "",
				});
			}
		};
		guest.on("before-input-event", find);
		return () => {
			guest.off("will-navigate", intercept);
			guest.off("will-redirect", intercept);
			guest.off("before-input-event", find);
			entry.sequence++;
			if (this.entries.get(key) === entry) this.entries.delete(key);
		};
	}
	private active(key: string, entry: Navigation): boolean {
		return (
			this.entries.get(key) === entry &&
			entry.current() &&
			!entry.guest.isDestroyed()
		);
	}
	private require(owner: number, pane: WorkstationBrowserPane): Navigation {
		const key = this.key(owner, pane),
			entry = this.entries.get(key);
		if (!entry || !this.active(key, entry))
			throw new Error("Browser registration changed");
		return entry;
	}
	canonical(owner: number, pane: WorkstationBrowserPane, raw: string): string {
		const entry = this.require(owner, pane);
		let url: URL;
		try {
			url = new URL(raw);
		} catch {
			return raw;
		}
		const origin = entry.origins.get(url.origin);
		if (!origin) return raw;
		if (origin) {
			const original = new URL(origin);
			url.host = original.host;
			url.protocol = original.protocol;
		}
		return url.href;
	}
	async navigate(
		owner: number,
		pane: WorkstationBrowserPane,
		raw: string,
	): Promise<WorkstationBrowserNavigationResult> {
		const entry = this.require(owner, pane),
			key = this.key(owner, pane),
			sequence = ++entry.sequence;
		const target = terminalUrlTarget(
			raw,
			this.dependencies.isLocal(pane.connectionId),
		);
		let about = false;
		try {
			about =
				new URL(raw).protocol === "about:" && !/[\x00-\x1f\x7f]/.test(raw);
		} catch {}
		if (!target && !about) throw new Error("Browser URL is not allowed");
		let guestUrl = target?.url ?? raw;
		if (target?.kind === "forward") {
			const forward = await this.dependencies.prepare(
				entry.descriptor,
				pane.workspaceId,
				target.port,
			);
			if (!this.active(key, entry))
				throw new Error("Browser navigation changed");
			if (entry.sequence !== sequence) return { status: "superseded" };
			const forwarded = forwardedTerminalUrl(target.url, forward.url);
			if (!forwarded) throw new Error("Browser forward URL is invalid");
			guestUrl = forwarded;
			if (
				entry.origins.size >= 32 &&
				!entry.origins.has(new URL(guestUrl).origin)
			)
				throw new Error("Browser forward limit exceeded");
			entry.origins.set(new URL(guestUrl).origin, new URL(target.url).origin);
		}
		if (!this.active(key, entry)) throw new Error("Browser navigation changed");
		if (entry.sequence !== sequence) return { status: "superseded" };
		const url = target?.url ?? raw;
		this.dependencies.send(owner, {
			...pane,
			type: "navigation-map",
			url,
			guestUrl,
		});
		try {
			await entry.guest.loadURL(guestUrl);
		} catch (error) {
			if (this.active(key, entry) && entry.sequence !== sequence)
				return { status: "superseded" };
			throw error;
		}
		if (!this.active(key, entry)) throw new Error("Browser navigation changed");
		if (entry.sequence !== sequence) return { status: "superseded" };
		return { status: "navigated", url, guestUrl };
	}
}

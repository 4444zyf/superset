import type { EventEmitter } from "node:events";
import type { DirectDescriptor } from "../../../shared/direct-workstation";
import type { ForwardedKey } from "../../../shared/hotkey-chord";
import {
	type WorkstationBrowserEvent,
	type WorkstationBrowserPane,
	workstationBrowserPaneSchema,
	workstationBrowserRegistrationSchema,
} from "../../../shared/workstation-browser";

interface BrowserManager extends Pick<EventEmitter, "on" | "off"> {
	register(paneId: string, webContentsId: number, workspaceId?: string): void;
	unregister(paneId: string): void;
	getAgentActivePaneIds(): string[];
}

interface BrowserGuest extends Pick<EventEmitter, "on" | "off"> {
	id: number;
	hostWebContents?: { id: number; isDestroyed(): boolean } | null;
	isDestroyed(): boolean;
	getType(): string;
	close(options: { waitForBeforeUnload: boolean }): void;
}

interface Registration {
	key: string;
	owner: { id: number };
	pane: WorkstationBrowserPane;
	descriptor: DirectDescriptor;
	guest: BrowserGuest;
	cleanup(): void;
}

const MAX_WINDOW_BROWSER_PANES = 128;

export class WorkstationBrowserRegistry {
	private owner: { id: number } | null = null;
	private registrations = new Map<string, Registration>();
	private pending = new Map<
		string,
		{ pane: WorkstationBrowserPane; token: object }
	>();

	constructor(
		private readonly dependencies: {
			manager: BrowserManager;
			getGuest(id: number): BrowserGuest | undefined;
			describe(connectionId: string): DirectDescriptor;
			checkWorkspace(pane: WorkstationBrowserPane): Promise<void>;
			send(ownerId: number, event: WorkstationBrowserEvent): void;
		},
	) {
		dependencies.manager.on("agent-active", this.onAgentActive);
	}

	activateOwner(ownerId: number | null): void {
		this.owner = ownerId === null ? null : { id: ownerId };
		this.pending.clear();
		this.releaseMatching(() => true);
	}

	private paneKey(pane: WorkstationBrowserPane): string {
		return JSON.stringify([
			pane.connectionId,
			pane.generation,
			pane.workspaceId,
			pane.paneId,
		]);
	}

	private current(record: Registration): boolean {
		if (record.owner !== this.owner || record.guest.isDestroyed()) return false;
		try {
			const descriptor = this.dependencies.describe(record.pane.connectionId);
			return (
				descriptor.connectionId === record.descriptor.connectionId &&
				descriptor.generation === record.descriptor.generation &&
				descriptor.backendId === record.descriptor.backendId &&
				descriptor.namespaceId === record.descriptor.namespaceId &&
				descriptor.instanceId === record.descriptor.instanceId
			);
		} catch {
			return false;
		}
	}

	async register(ownerId: number, input: unknown): Promise<void> {
		const { webContentsId, ...pane } =
			workstationBrowserRegistrationSchema.parse(input);
		const owner = this.owner;
		if (!owner || owner.id !== ownerId)
			throw new Error("Browser window owner changed");
		const descriptor = { ...this.dependencies.describe(pane.connectionId) };
		if (descriptor.generation !== pane.generation)
			throw new Error("Browser connection generation changed");
		const key = this.paneKey(pane);
		if (
			!this.registrations.has(key) &&
			!this.pending.has(key) &&
			new Set([...this.registrations.keys(), ...this.pending.keys()]).size >=
				MAX_WINDOW_BROWSER_PANES
		)
			throw new Error("Browser pane limit exceeded");
		const token = {};
		this.pending.set(key, { pane, token });
		try {
			await this.dependencies.checkWorkspace(pane);
			if (this.pending.get(key)?.token !== token || this.owner !== owner)
				throw new Error("Browser registration was cancelled");
			const guest = this.dependencies.getGuest(webContentsId);
			if (
				!guest ||
				guest.isDestroyed() ||
				guest.getType() !== "webview" ||
				guest.hostWebContents?.id !== ownerId ||
				guest.hostWebContents.isDestroyed()
			)
				throw new Error("Browser guest does not belong to this window");
			if (
				[...this.registrations.values()].some(
					(record) => record.guest.id === guest.id && record.key !== key,
				)
			)
				throw new Error("Browser guest is already registered to another pane");
			const record: Registration = {
				key,
				owner,
				pane,
				descriptor,
				guest,
				cleanup: () => {},
			};
			if (!this.current(record))
				throw new Error("Browser connection identity changed");
			const previous = this.registrations.get(key);
			if (previous) this.release(previous, previous.guest !== guest);
			const managerKey = this.managerKey(record);
			const detachListeners: (() => void)[] = [];
			const on = <T extends unknown[]>(
				event: string,
				listener: (...args: T) => void,
			) => {
				this.dependencies.manager.on(event, listener);
				detachListeners.push(() =>
					this.dependencies.manager.off(event, listener),
				);
			};
			const emit = (event: WorkstationBrowserEvent) => {
				if (this.registrations.get(key) === record && this.current(record))
					this.dependencies.send(ownerId, event);
			};
			on(`new-window:${managerKey}`, (url: string) =>
				emit({ ...pane, type: "new-window", url }),
			);
			on(
				`context-menu-action:${managerKey}`,
				(data: { action: string; url: string }) =>
					emit({ ...pane, ...data, type: "context-menu-action" }),
			);
			for (const type of ["close-pane", "reload-pane", "pane-focus"] as const)
				on(`${type}:${managerKey}`, () => emit({ ...pane, type }));
			on(`key-forward:${managerKey}`, (forwardedKey: ForwardedKey) =>
				emit({ ...pane, type: "key-forward", key: forwardedKey }),
			);
			const destroyed = () => this.release(record, false);
			guest.on("destroyed", destroyed);
			record.cleanup = () => {
				guest.off("destroyed", destroyed);
				for (const detach of detachListeners) detach();
			};
			this.registrations.set(key, record);
			try {
				this.dependencies.manager.register(
					managerKey,
					guest.id,
					pane.workspaceId,
				);
				this.onAgentActive();
			} catch (error) {
				this.release(record, false);
				throw error;
			}
		} finally {
			if (this.pending.get(key)?.token === token) this.pending.delete(key);
		}
	}

	private managerKey(record: Registration): string {
		const { connectionId, backendId, namespaceId, instanceId, generation } =
			record.descriptor;
		return JSON.stringify([
			"workstation",
			record.owner.id,
			connectionId,
			backendId,
			namespaceId,
			instanceId,
			generation,
			record.pane.workspaceId,
			record.pane.paneId,
			record.pane.registrationId,
		]);
	}

	unregister(ownerId: number, input: unknown): void {
		const pane = workstationBrowserPaneSchema.parse(input);
		if (this.owner?.id !== ownerId)
			throw new Error("Browser window owner changed");
		const key = this.paneKey(pane);
		if (this.pending.get(key)?.pane.registrationId === pane.registrationId)
			this.pending.delete(key);
		const record = this.registrations.get(key);
		if (record?.pane.registrationId === pane.registrationId)
			this.release(record, false);
	}

	closeConnection(connectionId: string): void {
		for (const [key, pending] of this.pending)
			if (pending.pane.connectionId === connectionId) this.pending.delete(key);
		this.releaseMatching((record) => record.pane.connectionId === connectionId);
	}

	private releaseMatching(predicate: (record: Registration) => boolean): void {
		const errors: unknown[] = [];
		for (const record of [...this.registrations.values()]) {
			if (!predicate(record)) continue;
			try {
				this.release(record, true);
			} catch (error) {
				errors.push(error);
			}
		}
		if (errors.length)
			throw new AggregateError(errors, "Browser cleanup failed");
	}

	private release(record: Registration, destroy: boolean): void {
		if (this.registrations.get(record.key) !== record) return;
		this.registrations.delete(record.key);
		try {
			record.cleanup();
		} finally {
			try {
				this.dependencies.manager.unregister(this.managerKey(record));
			} finally {
				if (destroy && !record.guest.isDestroyed())
					record.guest.close({ waitForBeforeUnload: false });
			}
		}
	}

	private onAgentActive = (): void => {
		const active = new Set(this.dependencies.manager.getAgentActivePaneIds());
		for (const record of this.registrations.values()) {
			if (!this.current(record)) continue;
			this.dependencies.send(record.owner.id, {
				...record.pane,
				type: "agent-active",
				active: active.has(this.managerKey(record)),
			});
		}
	};

	dispose(): void {
		this.dependencies.manager.off("agent-active", this.onAgentActive);
		this.activateOwner(null);
	}
}

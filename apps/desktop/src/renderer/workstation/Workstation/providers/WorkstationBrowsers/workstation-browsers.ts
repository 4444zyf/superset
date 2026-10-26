import { msg } from "@lingui/core/macro";
import { i18n } from "@superset/i18n";
import { toast } from "@superset/ui/sonner";
import { DesignModeStoreCore } from "renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/hooks/usePaneRegistry/components/BrowserPane/designModeStoreCore";
import { DeviceToolbarStoreCore } from "renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/hooks/usePaneRegistry/components/BrowserPane/deviceToolbarStoreCore";
import type { WorkstationBrowserDeviceEmulation } from "shared/workstation-browser";
import {
	BrowserRuntimeRegistryCore,
	type BrowserRuntimeState,
	type PersistableBrowserState,
} from "renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/hooks/usePaneRegistry/components/BrowserPane/browserRuntimeRegistryCore";
import { sanitizeUrl } from "renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/hooks/usePaneRegistry/components/BrowserPane/sanitizeUrl";
import type {
	DirectDescriptor,
	DirectWorkstationApi,
} from "shared/direct-workstation";
import type { WorkstationBrowserPane } from "shared/workstation-browser";
import type {
	WorkspacePaneV2,
	WorkspaceViewSnapshotV2,
} from "shared/workspace-view-v2";

type BrowserPane = Extract<WorkspacePaneV2, { kind: "browser" }>;
interface Runtime {
	id: string;
	descriptor: DirectDescriptor;
	workspaceId: string;
	pane: BrowserPane;
	registration: WorkstationBrowserPane | null;
	ready: Promise<void> | null;
	registered: boolean;
	desiredUrl: string;
	origins: Map<string, string>;
	version: number;
	deviceRevision: number;
	designPane?: WorkstationBrowserPane;
	offState?: () => void;
	lastPersist?: string;
	cached?: {
		raw: BrowserRuntimeState;
		version: number;
		state: BrowserRuntimeState;
	};
	onPersist(state: PersistableBrowserState): void;
	onClose(): void;
	onFocus(): void;
	onNewWindow(url: string): void;
	onFind(): void;
	onError(error: unknown): void;
}

const instances = new WeakMap<DirectWorkstationApi, WorkstationBrowsers>();

export function workstationBrowsers(
	api: DirectWorkstationApi,
): WorkstationBrowsers {
	let runtime = instances.get(api);
	if (!runtime) {
		runtime = new WorkstationBrowsers(api);
		instances.set(api, runtime);
	}
	return runtime;
}

export class WorkstationBrowsers {
	readonly core: BrowserRuntimeRegistryCore;
	readonly devices: DeviceToolbarStoreCore;
	readonly designs: DesignModeStoreCore;
	private readonly entries = new Map<string, Runtime>();
	private readonly agentListeners = new Set<
		(data: { paneIds: string[] }) => void
	>();
	private readonly agentActive = new Set<string>();
	constructor(private readonly api: DirectWorkstationApi) {
		this.designs = new DesignModeStoreCore(
			{
				designModeSet: {
					mutate: ({ paneId, enabled }) => this.setDesignMode(paneId, enabled),
				},
				designModeAwaitSelection: {
					mutate: async ({ paneId, opId }) => {
						const scope = this.designScope(paneId);
						const result = await scope.source.awaitSelection({
							pane: scope.pane,
							opId,
						});
						scope.assertCurrent();
						if (result.kind === "selected") {
							const runtime = this.entries.get(paneId)!;
							return {
								...result,
								payload: {
									...result.payload,
									page: {
										...result.payload.page,
										sanitizedUrl: this.canonical(
											runtime,
											result.payload.page.sanitizedUrl,
										),
									},
								},
							};
						}
						return result;
					},
				},
				designModeScreenshot: {
					mutate: async ({ paneId, rect }) => {
						const scope = this.designScope(paneId);
						const result = await scope.source.screenshot({
							pane: scope.pane,
							rect,
						});
						scope.assertCurrent();
						return result;
					},
				},
			},
			toast.error,
		);
		this.devices = new DeviceToolbarStoreCore(({ paneId, params }) =>
			this.setDeviceEmulation(paneId, params),
		);
		this.core = new BrowserRuntimeRegistryCore({
			browser: {
				register: {
					mutate: async ({ paneId, webContentsId }) => {
						const runtime = this.entries.get(paneId);
						if (!runtime || !api.browser?.navigate)
							throw Error("Browser runtime is unavailable");
						this.exitDesignMode(paneId);
						const registration = {
							connectionId: runtime.descriptor.connectionId,
							generation: runtime.descriptor.generation,
							workspaceId: runtime.workspaceId,
							paneId: runtime.pane.paneId,
							registrationId: crypto.randomUUID(),
						};
						runtime.registration = registration;
						runtime.registered = false;
						const ready = api.browser.register({
							...registration,
							webContentsId,
						});
						runtime.ready = ready;
						await ready;
						if (
							this.entries.get(paneId) !== runtime ||
							runtime.registration !== registration
						) {
							await api.browser.unregister(registration);
							return;
						}
						runtime.registered = true;
						await this.navigate(paneId, runtime.desiredUrl);
					},
				},
				unregister: {
					mutate: async ({ paneId }) => {
						const runtime = this.entries.get(paneId);
						if (!runtime) return;
						this.exitDesignMode(paneId);
						const registration = runtime.registration;
						runtime.registration = null;
						runtime.ready = null;
						runtime.registered = false;
						this.agentActive.delete(paneId);
						if (registration) await api.browser?.unregister(registration);
					},
				},
				onAgentActivePanes: {
					subscribe: (_input, { onData }) => {
						this.agentListeners.add(onData);
						return {
							unsubscribe: () => {
								this.agentListeners.delete(onData);
							},
						};
					},
				},
			},
			browserHistory: {
				upsert: {
					mutate: async () => {
						throw Error("A browser pane is required for history");
					},
				},
				upsertForPane: async (paneId, input) => {
					const runtime = this.entries.get(paneId);
					if (!runtime?.registration) return;
					const registration = runtime.registration;
					await runtime.ready;
					if (
						this.entries.get(paneId) !== runtime ||
						runtime.registration !== registration
					)
						return;
					await api.browser?.history?.upsert({
						...input,
						url: this.canonical(runtime, input.url),
						faviconUrl: input.faviconUrl
							? this.canonical(runtime, input.faviconUrl)
							: input.faviconUrl,
					});
				},
			},
		});
		api.browser?.onEvent((event) => {
			const runtime = [...this.entries.values()].find(
				(entry) =>
					entry.registration?.registrationId === event.registrationId &&
					entry.descriptor.connectionId === event.connectionId &&
					entry.descriptor.generation === event.generation &&
					entry.workspaceId === event.workspaceId &&
					entry.pane.paneId === event.paneId,
			);
			if (!runtime) return;
			switch (event.type) {
				case "navigation-map": {
					const actual = new URL(event.guestUrl),
						canonical = new URL(event.url);
					runtime.origins.set(actual.origin, canonical.origin);
					runtime.version++;
					break;
				}
				case "navigation-error":
					runtime.onError(new Error(event.message));
					break;
				case "new-window":
					runtime.onNewWindow(this.canonical(runtime, event.url));
					break;
				case "close-pane":
					runtime.onClose();
					break;
				case "pane-focus":
					runtime.onFocus();
					break;
				case "reload-pane":
					this.core.reload(runtime.id);
					break;
				case "context-menu-action":
					if (event.action === "find") runtime.onFind();
					else if (event.action === "open-in-split")
						runtime.onNewWindow(this.canonical(runtime, event.url));
					break;
				case "key-forward":
					if (
						(event.key.control || event.key.meta) &&
						event.key.key.toLowerCase() === "f"
					)
						runtime.onFind();
					break;
				case "agent-active":
					if (event.active) this.agentActive.add(runtime.id);
					else this.agentActive.delete(runtime.id);
					for (const listener of this.agentListeners)
						listener({ paneIds: [...this.agentActive] });
					break;
			}
		});
		api.onConnection?.((event) => {
			for (const entry of [...this.entries.values()]) {
				if (
					entry.descriptor.connectionId === event.connectionId &&
					(event.kind !== "connected" ||
						entry.descriptor.generation !== event.descriptor.generation ||
						entry.descriptor.instanceId !== event.descriptor.instanceId)
				)
					this.destroy(entry.id);
			}
		});
	}
	ensure(
		descriptor: DirectDescriptor,
		workspaceId: string,
		pane: BrowserPane,
		callbacks: Pick<
			Runtime,
			"onPersist" | "onClose" | "onFocus" | "onNewWindow" | "onFind" | "onError"
		>,
	): string {
		const id = JSON.stringify([
			descriptor.connectionId,
			descriptor.backendId,
			descriptor.namespaceId,
			descriptor.instanceId,
			descriptor.generation,
			workspaceId,
			pane.paneId,
			pane.resourceId,
		]);
		let runtime = this.entries.get(id);
		if (!runtime) {
			if (this.entries.size >= 128) {
				const evicted = [...this.entries.values()].find(
					(entry) => !entry.registration,
				);
				if (evicted) this.destroy(evicted.id);
				else throw Error("Browser pane limit exceeded");
			}
			runtime = {
				id,
				descriptor: { ...descriptor },
				workspaceId,
				pane: structuredClone(pane),
				registration: null,
				ready: null,
				registered: false,
				desiredUrl: pane.browser.url,
				origins: new Map(),
				version: 0,
				deviceRevision: 0,
				...callbacks,
			};
			this.entries.set(id, runtime);
			const entry = runtime;
			runtime.offState = this.core.onStateChange(id, () => {
				const state = this.core.getState(id);
				if (state.isLoading && this.designs.getState(id).phase === "confirming")
					this.designs.exit(id);
				this.persist(entry, {
					url: state.currentUrl,
					pageTitle: state.pageTitle,
					faviconUrl: state.faviconUrl,
				});
			});
		} else Object.assign(runtime, callbacks);
		return id;
	}
	private persist(runtime: Runtime, state: PersistableBrowserState): void {
		if (
			this.entries.get(runtime.id) !== runtime ||
			!runtime.registration ||
			!runtime.registered
		)
			return;
		if (state.url === "about:blank" && runtime.desiredUrl !== "about:blank")
			return;
		const canonical = {
			...state,
			url: this.canonical(runtime, state.url),
			faviconUrl: state.faviconUrl
				? this.canonical(runtime, state.faviconUrl)
				: null,
		};
		const encoded = JSON.stringify(canonical);
		if (runtime.lastPersist === encoded) return;
		runtime.lastPersist = encoded;
		runtime.desiredUrl = canonical.url;
		runtime.onPersist(canonical);
	}
	private canonical(runtime: Runtime, raw: string): string {
		try {
			const url = new URL(raw),
				origin = runtime.origins.get(url.origin);
			if (origin && origin !== "null") {
				const source = new URL(origin);
				url.host = source.host;
				url.protocol = source.protocol;
			}
			return url.href;
		} catch {
			return raw;
		}
	}
	readonly state = {
		onStateChange: (id: string, listener: () => void) =>
			this.core.onStateChange(id, listener),
		getState: (id: string): BrowserRuntimeState => {
			const raw = this.core.getState(id),
				runtime = this.entries.get(id);
			if (!runtime) return raw;
			if (
				runtime.cached?.raw === raw &&
				runtime.cached.version === runtime.version
			)
				return runtime.cached.state;
			const state = {
				...raw,
				currentUrl: this.canonical(runtime, raw.currentUrl),
			};
			runtime.cached = { raw, version: runtime.version, state };
			return state;
		},
	};
	attach(id: string, element: HTMLElement): void {
		const runtime = this.entries.get(id);
		if (!runtime) return;
		this.core.attach(
			id,
			element,
			"about:blank",
			runtime.workspaceId,
			(state) => {
				this.persist(runtime, state);
			},
			() => runtime.onClose(),
		);
	}
	detach(id: string): void {
		this.exitDesignMode(id);
		this.core.detach(id);
	}
	registration(id: string): WorkstationBrowserPane | null {
		return this.entries.get(id)?.registration ?? null;
	}
	async navigate(id: string, raw: string): Promise<void> {
		const runtime = this.entries.get(id);
		if (!runtime) return;
		const url = sanitizeUrl(raw);
		if (!url) return;
		runtime.desiredUrl = url;
		if (!runtime.ready || !runtime.registration) return;
		const registration = runtime.registration;
		await runtime.ready;
		if (
			this.entries.get(id) !== runtime ||
			runtime.registration !== registration
		)
			return;
		await this.api.browser?.navigate?.({ pane: registration, url });
	}
	reconcile(
		view: WorkspaceViewSnapshotV2 | null,
		connection?: DirectDescriptor | null,
	): void {
		if (!view) {
			this.clear();
			return;
		}
		for (const entry of [...this.entries.values()]) {
			if (
				connection?.connectionId === entry.descriptor.connectionId &&
				(connection.generation !== entry.descriptor.generation ||
					connection.instanceId !== entry.descriptor.instanceId)
			) {
				this.destroy(entry.id);
				continue;
			}
			const target = view.targets.find(
				(t) =>
					t.connectionId === entry.descriptor.connectionId &&
					t.backendId === entry.descriptor.backendId &&
					t.namespaceId === entry.descriptor.namespaceId,
			);
			const pane = target?.workspaces
				.find((w) => w.workspaceId === entry.workspaceId)
				?.panes.find(
					(p) =>
						p.kind === "browser" &&
						p.paneId === entry.pane.paneId &&
						p.resourceId === entry.pane.resourceId,
				);
			if (!pane) this.destroy(entry.id);
		}
	}
	private exitDesignMode(id: string): void {
		if (this.designs.getState(id).phase !== "idle") this.designs.exit(id);
	}
	private designScope(id: string) {
		const runtime = this.entries.get(id),
			pane = runtime?.designPane,
			source = this.api.browser?.designMode;
		const assertCurrent = () => {
			if (
				!runtime ||
				!pane ||
				!source ||
				this.entries.get(id) !== runtime ||
				runtime.designPane !== pane ||
				runtime.registration !== pane ||
				!runtime.registered
			)
				throw Error(i18n._(msg({ message: "Session status unavailable." })));
		};
		assertCurrent();
		return { source: source!, pane: pane!, assertCurrent };
	}
	private async setDesignMode(
		id: string,
		enabled: boolean,
	): Promise<{ ok: boolean }> {
		const runtime = this.entries.get(id),
			source = this.api.browser?.designMode;
		if (!runtime || !runtime.registered || !runtime.registration || !source)
			return { ok: false };
		const pane = enabled
			? runtime.registration
			: (runtime.designPane ?? runtime.registration);
		if (enabled) runtime.designPane = pane;
		else runtime.designPane = undefined;
		const result = await source.set({ pane, enabled });
		return this.entries.get(id) === runtime &&
			runtime.registration === pane &&
			(!enabled || runtime.designPane === pane)
			? result
			: { ok: false };
	}
	private async setDeviceEmulation(
		id: string,
		params: WorkstationBrowserDeviceEmulation,
	): Promise<void> {
		const runtime = this.entries.get(id);
		if (!runtime) return;
		const version = ++runtime.deviceRevision,
			registration = runtime.registration;
		const current = () =>
			this.entries.get(id) === runtime &&
			runtime.deviceRevision === version &&
			runtime.registration === registration;
		try {
			if (
				!registration ||
				!runtime.registered ||
				!this.api.browser?.setDeviceEmulation
			) {
				if (params)
					throw Error(i18n._(msg({ message: "Session status unavailable." })));
				return;
			}
			const result = await this.api.browser.setDeviceEmulation({
				pane: registration,
				params,
			});
			if (current() && result.status === "stale")
				throw Error(i18n._(msg({ message: "Session status unavailable." })));
		} catch (error) {
			if (current()) runtime.onError(error);
			throw error;
		}
	}
	destroy(id: string): void {
		this.exitDesignMode(id);
		this.devices.reset(id);
		this.entries.get(id)?.offState?.();
		this.core.destroy(id);
		this.entries.delete(id);
		this.agentActive.delete(id);
	}
	clear(): void {
		for (const id of [...this.entries.keys()]) this.destroy(id);
	}
}

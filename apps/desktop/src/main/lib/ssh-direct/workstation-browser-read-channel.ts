import { WorkstationBrowserCookieImportError } from "./workstation-browser-cookie-imports";
import {
	browserBridgeCookieImportResultSchema,
	browserBridgeImportSourcesResultSchema,
	browserBridgeConsoleResultSchema,
	browserBridgeListResultSchema,
	encodeBrowserBridgePacket,
	parseBrowserBridgePacket,
	browserCapturePackets,
	type BrowserBridgeReadOperation,
	type BrowserBridgePacket,
} from "@superset/shared/browser-bridge";
import type { DirectDescriptor } from "../../../shared/direct-workstation";
import type { currentWorkstationBrowserBridgePanes } from "./workstation-browser-bridge-panes";

type OpenRequest = Extract<BrowserBridgePacket, { type: "open-request" }>;
type OpenResult = Extract<
	BrowserBridgePacket,
	{ type: "open-result"; ok: true }
>["result"];
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
	captureReady: boolean;
	captureId: string | null;
	cookieImportReady: boolean;
	cookieImportId: string | null;
	cookieImportRelease: (() => void) | null;
	importSourcesReady: boolean;
	importSourcesId: string | null;
	reloadReady: boolean;
	reloadId: string | null;
	navigationReady: boolean;
	evaluationReady: boolean;
	evaluationId: string | null;
	openNegotiated: boolean;
	openId: string | null;
	openRelease: (() => void) | null;
	navigationId: string | null;
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
			importCookiesV1?: boolean;
			pinCookieImport?(
				target: BrowserReadTarget,
				request: Extract<
					BrowserBridgePacket,
					{ type: "import-cookies-request" }
				>,
				current: () => boolean,
			): (() => Promise<unknown>) & { release?(): void };
			importSourcesV1?: boolean;
			importSources?(
				target: BrowserReadTarget,
				current: () => boolean,
			): Promise<unknown>;
			reloadV1?: boolean;
			navigationV1?: boolean;
			evaluationV1?: boolean;
			openV1?: boolean;
			openAvailability?(target: BrowserReadTarget): {
				scopeId: string;
				ready: boolean;
				accepting: boolean;
			};
			pinOpen?(
				target: BrowserReadTarget,
				request: OpenRequest,
				current: () => boolean,
			): (() => Promise<OpenResult>) & { release?(): void };
			getTarget(id: string): BrowserReadTarget | null;
			openSocket(id: string, path: string): Socket;
			panes(
				target: BrowserReadTarget,
				isCurrent: () => boolean,
			): Pick<
				ReturnType<typeof currentWorkstationBrowserBridgePanes>,
				"listPanes" | "getConsoleLogs" | "capturePng"
			> &
				Partial<
					Pick<
						ReturnType<typeof currentWorkstationBrowserBridgePanes>,
						"pinNavigation" | "pinEvaluation" | "pinReload"
					>
				>;
		},
	) {}
	private supportsCookieImport(): boolean {
		return (
			this.dependencies.importCookiesV1 === true &&
			!!this.dependencies.pinCookieImport
		);
	}
	private supportsImportSources(): boolean {
		return (
			this.dependencies.importSourcesV1 === true &&
			!!this.dependencies.importSources
		);
	}
	private supportsOpen(): boolean {
		return (
			this.dependencies.openV1 === true &&
			!!this.dependencies.openAvailability &&
			!!this.dependencies.pinOpen
		);
	}
	publishOpenAvailability(): void {
		for (const entry of this.entries.values()) {
			try {
				this.sendOpenAvailability(entry);
			} catch {
				this.close(entry, 1011);
			}
		}
	}
	private sendOpenAvailability(entry: Entry): void {
		if (!entry.ready || !entry.openNegotiated || !this.current(entry)) return;
		const availability = this.dependencies.openAvailability?.(entry.target);
		if (!availability) throw Error("Browser open availability is missing");
		if (!this.current(entry)) return;
		entry.socket.send(
			encodeBrowserBridgePacket({ type: "open-availability", ...availability }),
		);
	}
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
	private releaseCookieImport(entry: Entry): void {
		const release = entry.cookieImportRelease;
		entry.cookieImportRelease = null;
		try {
			release?.();
		} catch {}
	}
	private releaseOpen(entry: Entry): void {
		const release = entry.openRelease;
		entry.openRelease = null;
		try {
			release?.();
		} catch {}
	}
	private close(entry: Entry, code = 1000): void {
		if (entry.closing) return;
		entry.closing = true;
		this.releaseCookieImport(entry);
		this.releaseOpen(entry);
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
			captureReady: false,
			captureId: null,
			cookieImportReady: false,
			cookieImportId: null,
			cookieImportRelease: null,
			importSourcesReady: false,
			importSourcesId: null,
			reloadReady: false,
			reloadId: null,
			navigationReady: false,
			evaluationReady: false,
			evaluationId: null,
			openNegotiated: false,
			openId: null,
			openRelease: null,
			navigationId: null,
			closing: false,
			next: null,
			pending: new Set(),
		};
		this.entries.set(id, entry);
		socket.addEventListener("close", () => {
			this.releaseCookieImport(entry);
			this.releaseOpen(entry);
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
						features: [
							"readV1",
							"capturePngV1",
							...(this.dependencies.navigationV1 ? ["navigateV1"] : []),
							...(this.dependencies.reloadV1 ? ["reloadV1"] : []),
							...(this.supportsImportSources() ? ["importSourcesV1"] : []),
							...(this.supportsCookieImport() ? ["importCookiesV1"] : []),
							...(this.dependencies.evaluationV1 ? ["evaluateV1"] : []),
							...(this.supportsOpen() ? ["openV1"] : []),
						],
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
					entry.openNegotiated =
						this.supportsOpen() && packet.features.includes("openV1");
					entry.captureReady = packet.features.includes("capturePngV1");
					entry.evaluationReady =
						this.dependencies.evaluationV1 === true &&
						packet.features.includes("evaluateV1");
					entry.cookieImportReady =
						this.supportsCookieImport() &&
						packet.features.includes("importCookiesV1");
					entry.importSourcesReady =
						this.supportsImportSources() &&
						packet.features.includes("importSourcesV1");
					entry.reloadReady =
						this.dependencies.reloadV1 === true &&
						packet.features.includes("reloadV1");
					entry.navigationReady =
						this.dependencies.navigationV1 === true &&
						packet.features.includes("navigateV1");
					this.sendOpenAvailability(entry);
					return;
				}
				if (packet.type === "open-request") {
					if (!entry.openNegotiated || entry.openId !== null)
						throw Error("Invalid browser open request");
					entry.openId = packet.id;
					void this.openBrowser(entry, packet).catch(() =>
						this.close(entry, 1011),
					);
					return;
				}
				if (packet.type === "evaluate-request") {
					if (!entry.evaluationReady || entry.evaluationId !== null)
						throw Error("Invalid evaluation request");
					entry.evaluationId = packet.id;
					void this.evaluate(entry, packet).catch(() =>
						this.close(entry, 1011),
					);
					return;
				}
				if (packet.type === "import-cookies-request") {
					if (!entry.cookieImportReady || entry.cookieImportId !== null)
						throw Error("Invalid browser cookie import request");
					entry.cookieImportId = packet.id;
					void this.importCookies(entry, packet).catch(() =>
						this.close(entry, 1011),
					);
					return;
				}
				if (packet.type === "import-sources-request") {
					if (!entry.importSourcesReady || entry.importSourcesId !== null)
						throw Error("Invalid browser source request");
					entry.importSourcesId = packet.id;
					void this.readImportSources(entry, packet).catch(() =>
						this.close(entry, 1011),
					);
					return;
				}
				if (packet.type === "reload-request") {
					if (!entry.reloadReady || entry.reloadId !== null)
						throw Error("Invalid reload request");
					entry.reloadId = packet.id;
					void this.reload(entry, packet).catch(() => this.close(entry, 1011));
					return;
				}
				if (packet.type === "navigate-request") {
					if (!entry.navigationReady || entry.navigationId !== null)
						throw Error("Invalid navigation request");
					entry.navigationId = packet.id;
					void this.navigate(entry, packet).catch(() =>
						this.close(entry, 1011),
					);
					return;
				}
				if (packet.type === "capture-request") {
					if (!entry.captureReady || entry.captureId !== null)
						throw Error("Invalid screenshot request");
					entry.captureId = packet.id;
					void this.capturePng(entry, packet).catch(() =>
						this.close(entry, 1011),
					);
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
	private async openBrowser(entry: Entry, request: OpenRequest): Promise<void> {
		let release: (() => void) | null = null;
		try {
			if (!this.current(entry)) {
				this.close(entry);
				return;
			}
			const availability = this.dependencies.openAvailability?.(entry.target);
			if (
				!availability?.ready ||
				availability.scopeId !== request.scopeId ||
				!this.dependencies.pinOpen
			)
				throw Error("Browser open scope is unavailable");
			const execute = this.dependencies.pinOpen(entry.target, request, () =>
				this.current(entry),
			);
			release = () => execute.release?.();
			entry.openRelease = release;
			const result = await execute();
			if (!this.current(entry)) {
				this.close(entry);
				return;
			}
			const current = this.dependencies.openAvailability?.(entry.target);
			if (!current?.ready || current.scopeId !== request.scopeId)
				throw Error("Browser open scope changed");
			entry.socket.send(
				encodeBrowserBridgePacket({
					type: "open-result",
					id: request.id,
					scopeId: request.scopeId,
					ok: true,
					result,
				}),
			);
		} catch {
			if (!this.current(entry)) {
				this.close(entry);
				return;
			}
			entry.socket.send(
				encodeBrowserBridgePacket({
					type: "open-result",
					id: request.id,
					scopeId: request.scopeId,
					ok: false,
					error: {
						message: "Browser open failed or view scope is no longer current",
					},
				}),
			);
		} finally {
			if (release && entry.openRelease === release) this.releaseOpen(entry);
			if (entry.openId === request.id) entry.openId = null;
		}
	}
	private async importCookies(
		entry: Entry,
		request: Extract<BrowserBridgePacket, { type: "import-cookies-request" }>,
	): Promise<void> {
		let release: (() => void) | undefined;
		try {
			if (!this.current(entry)) {
				this.close(entry);
				return;
			}
			if (!this.dependencies.pinCookieImport)
				throw Error("Browser cookie import is unavailable");
			const execute = this.dependencies.pinCookieImport(
				entry.target,
				request,
				() => this.current(entry),
			);
			release = execute.release;
			entry.cookieImportRelease = release ?? null;
			const result = await execute();
			if (!this.current(entry)) {
				this.close(entry);
				return;
			}
			const value = browserBridgeCookieImportResultSchema.parse(result);
			entry.socket.send(
				encodeBrowserBridgePacket({
					type: "import-cookies-result",
					id: request.id,
					ok: true,
					result: value,
				}),
			);
		} catch (error) {
			if (!this.current(entry)) {
				this.close(entry);
				return;
			}
			const kind =
				error instanceof WorkstationBrowserCookieImportError
					? error.kind
					: "failed";
			entry.socket.send(
				encodeBrowserBridgePacket({
					type: "import-cookies-result",
					id: request.id,
					ok: false,
					error: {
						kind,
						message:
							"Browser cookie import failed or target is no longer current",
					},
				}),
			);
		} finally {
			if (release && entry.cookieImportRelease === release)
				this.releaseCookieImport(entry);
			if (entry.cookieImportId === request.id) entry.cookieImportId = null;
		}
	}
	private async readImportSources(
		entry: Entry,
		request: { id: string },
	): Promise<void> {
		try {
			if (!this.current(entry)) {
				this.close(entry);
				return;
			}
			if (!this.dependencies.importSources)
				throw Error("Browser source listing is unavailable");
			const result = await this.dependencies.importSources(entry.target, () =>
				this.current(entry),
			);
			if (!this.current(entry)) {
				this.close(entry);
				return;
			}
			const value = browserBridgeImportSourcesResultSchema.parse(result);
			entry.socket.send(
				encodeBrowserBridgePacket({
					type: "import-sources-result",
					id: request.id,
					ok: true,
					result: value,
				}),
			);
		} catch {
			if (!this.current(entry)) {
				this.close(entry);
				return;
			}
			entry.socket.send(
				encodeBrowserBridgePacket({
					type: "import-sources-result",
					id: request.id,
					ok: false,
					error: { message: "Browser login sources are unavailable" },
				}),
			);
		} finally {
			if (entry.importSourcesId === request.id) entry.importSourcesId = null;
		}
	}
	private async reload(
		entry: Entry,
		request: { id: string; paneId: string; workspaceId: string; hard: boolean },
	): Promise<void> {
		try {
			if (!this.current(entry)) {
				this.close(entry);
				return;
			}
			const panes = this.dependencies.panes(entry.target, () =>
				this.current(entry),
			);
			if (!panes.pinReload) throw Error("Browser reload is unavailable");
			await panes.pinReload(
				request.paneId,
				request.workspaceId,
				request.hard,
			)();
			if (!this.current(entry)) {
				this.close(entry);
				return;
			}
			entry.socket.send(
				encodeBrowserBridgePacket({
					type: "reload-result",
					id: request.id,
					ok: true,
				}),
			);
		} catch {
			if (!this.current(entry)) {
				this.close(entry);
				return;
			}
			entry.socket.send(
				encodeBrowserBridgePacket({
					type: "reload-result",
					id: request.id,
					ok: false,
					error: {
						message: "Browser reload failed or pane is no longer current",
					},
				}),
			);
		} finally {
			if (entry.reloadId === request.id) entry.reloadId = null;
		}
	}
	private async navigate(
		entry: Entry,
		request: { id: string; paneId: string; workspaceId: string; url: string },
	): Promise<void> {
		try {
			if (!this.current(entry)) {
				this.close(entry);
				return;
			}
			const panes = this.dependencies.panes(entry.target, () =>
				this.current(entry),
			);
			if (!panes.pinNavigation)
				throw Error("Browser navigation is unavailable");
			await panes.pinNavigation(
				request.paneId,
				request.workspaceId,
				request.url,
			)();
			if (!this.current(entry)) {
				this.close(entry);
				return;
			}
			entry.socket.send(
				encodeBrowserBridgePacket({
					type: "navigate-result",
					id: request.id,
					ok: true,
				}),
			);
		} catch {
			if (!this.current(entry)) {
				this.close(entry);
				return;
			}
			entry.socket.send(
				encodeBrowserBridgePacket({
					type: "navigate-result",
					id: request.id,
					ok: false,
					error: {
						message: "Browser navigation failed or pane is no longer current",
					},
				}),
			);
		} finally {
			if (entry.navigationId === request.id) entry.navigationId = null;
		}
	}
	private async evaluate(
		entry: Entry,
		request: { id: string; paneId: string; workspaceId: string; code: string },
	): Promise<void> {
		try {
			if (!this.current(entry)) {
				this.close(entry);
				return;
			}
			const panes = this.dependencies.panes(entry.target, () =>
				this.current(entry),
			);
			if (!panes.pinEvaluation)
				throw Error("Browser evaluation is unavailable");
			const value = await panes.pinEvaluation(
				request.paneId,
				request.workspaceId,
				request.code,
			)();
			if (!this.current(entry)) {
				this.close(entry);
				return;
			}
			entry.socket.send(
				encodeBrowserBridgePacket({
					type: "evaluate-result",
					id: request.id,
					ok: true,
					result: value.result,
				}),
			);
		} catch {
			if (!this.current(entry)) {
				this.close(entry);
				return;
			}
			entry.socket.send(
				encodeBrowserBridgePacket({
					type: "evaluate-result",
					id: request.id,
					ok: false,
					error: {
						message: "Browser evaluation failed or pane is no longer current",
					},
				}),
			);
		} finally {
			if (entry.evaluationId === request.id) entry.evaluationId = null;
		}
	}
	private async capturePng(
		entry: Entry,
		request: { id: string; workspaceId: string; paneId: string },
	): Promise<void> {
		try {
			if (!this.current(entry)) {
				this.close(entry);
				return;
			}
			const panes = this.dependencies.panes(entry.target, () =>
				this.current(entry),
			);
			const base64 = await panes.capturePng(
				request.paneId,
				request.workspaceId,
			);
			if (!this.current(entry)) {
				this.close(entry);
				return;
			}
			for (const packet of browserCapturePackets(request.id, base64)) {
				if (!this.current(entry)) {
					this.close(entry);
					return;
				}
				entry.socket.send(encodeBrowserBridgePacket(packet));
			}
		} catch {
			if (!this.current(entry)) {
				this.close(entry);
				return;
			}
			entry.socket.send(
				encodeBrowserBridgePacket({
					type: "capture-done",
					id: request.id,
					ok: false,
					error: {
						message: "Browser screenshot failed or pane is no longer current",
					},
				}),
			);
		} finally {
			if (entry.captureId === request.id) entry.captureId = null;
		}
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

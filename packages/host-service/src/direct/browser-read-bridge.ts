import type { BrowserCookieImportInput } from "./browser-cookie-import-operation";
import { BrowserCookieImportTransfer } from "./browser-cookie-import-transfer";
import { BrowserImportSourcesTransfer } from "./browser-import-sources-transfer";
import type { BrowserReloadInput } from "./browser-reload-operation";
import { BrowserReloadTransfer } from "./browser-reload-transfer";
import { BrowserOpenTransfer } from "./browser-open-transfer";
import type { BrowserOpenInput } from "./browser-open-operation";
import { randomUUID } from "node:crypto";
import {
	type BrowserBridgeConsoleResult,
	type BrowserBridgeIdentity,
	type BrowserBridgeListResult,
	type BrowserBridgePacket,
	type BrowserBridgeReadOperation,
	browserBridgeConsoleResultSchema,
	browserBridgeIdentitySchema,
	browserBridgeListResultSchema,
	browserBridgeReadOperationSchema,
	encodeBrowserBridgePacket,
	parseBrowserBridgePacket,
} from "@superset/shared/browser-bridge";
import { BrowserCaptureTransfer } from "./browser-capture-transfer";
import type { BrowserEvaluationInput } from "./browser-evaluation-operation";
import { BrowserEvaluationTransfer } from "./browser-evaluation-transfer";
import type { BrowserNavigationInput } from "./browser-navigation-operation";
import { BrowserNavigationTransfer } from "./browser-navigation-transfer";

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
	capturePngV1: boolean;
	importCookiesV1: boolean;
	importSourcesV1: boolean;
	reloadV1: boolean;
	navigateV1: boolean;
	evaluateV1: boolean;
	openV1: boolean;
	openScopeId: string | null;
	openAccepting: boolean;
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
	private readonly capture: BrowserCaptureTransfer;
	private readonly cookieImportTransfer: BrowserCookieImportTransfer;
	private readonly importSourcesTransfer: BrowserImportSourcesTransfer;
	private readonly reload: BrowserReloadTransfer;
	private readonly navigation: BrowserNavigationTransfer;
	private readonly evaluation: BrowserEvaluationTransfer;
	private readonly openTransfer: BrowserOpenTransfer;
	constructor(
		identity: BrowserBridgeIdentity,
		options: { schedule?: typeof schedule } = {},
	) {
		this.identity = browserBridgeIdentitySchema.parse(identity);
		this.schedule = options.schedule ?? schedule;
		this.openTransfer = new BrowserOpenTransfer({
			schedule: this.schedule,
			failure: (kind, message) => new DirectBrowserBridgeError(kind, message),
		});
		this.evaluation = new BrowserEvaluationTransfer({
			schedule: this.schedule,
			failure: (kind, message) => new DirectBrowserBridgeError(kind, message),
		});
		this.cookieImportTransfer = new BrowserCookieImportTransfer({
			schedule: this.schedule,
			failure: (kind, message) => new DirectBrowserBridgeError(kind, message),
		});
		this.importSourcesTransfer = new BrowserImportSourcesTransfer({
			schedule: this.schedule,
			failure: (kind, message) => new DirectBrowserBridgeError(kind, message),
		});
		this.reload = new BrowserReloadTransfer({
			schedule: this.schedule,
			failure: (kind, message) => new DirectBrowserBridgeError(kind, message),
		});
		this.navigation = new BrowserNavigationTransfer({
			schedule: this.schedule,
			failure: (kind, message) => new DirectBrowserBridgeError(kind, message),
		});
		this.capture = new BrowserCaptureTransfer({
			ready: () => this.isCaptureReady(),
			send: (packet) => {
				if (this.peer) this.send(this.peer, packet);
			},
			schedule: this.schedule,
			failure: (kind, message) => new DirectBrowserBridgeError(kind, message),
		});
	}
	isReady(): boolean {
		return !this.disposed && this.peer?.ready === true;
	}
	isCaptureReady(): boolean {
		return this.isReady() && this.peer?.capturePngV1 === true;
	}
	capturePng(workspaceId: string, paneId: string): Promise<{ base64: string }> {
		return this.capture.capturePng(workspaceId, paneId);
	}
	isImportSourcesReady(): boolean {
		return this.isReady() && this.peer?.importSourcesV1 === true;
	}
	importSources() {
		const peer = this.peer;
		if (!peer || !this.isImportSourcesReady())
			return Promise.reject(
				new DirectBrowserBridgeError(
					"unavailable",
					"Browser login source bridge is unavailable",
				),
			);
		return this.importSourcesTransfer.read({
			current: () => this.peer === peer && this.isImportSourcesReady(),
			send: (packet) => this.send(peer, packet),
			invalidate: (error) =>
				this.drop(
					peer,
					error instanceof DirectBrowserBridgeError
						? error
						: new DirectBrowserBridgeError(
								"unavailable",
								"Browser login source disconnected",
							),
					1011,
				),
		});
	}
	isCookieImportReady(): boolean {
		return this.isReady() && this.peer?.importCookiesV1 === true;
	}
	pinCookieImport(input: BrowserCookieImportInput) {
		const peer = this.peer;
		if (!peer || !this.isCookieImportReady())
			throw new DirectBrowserBridgeError(
				"unavailable",
				"Browser cookie import bridge is unavailable",
			);
		return this.cookieImportTransfer.pin(input, {
			current: () => this.peer === peer && this.isCookieImportReady(),
			send: (packet) => this.send(peer, packet),
			invalidate: (error) =>
				this.drop(
					peer,
					error instanceof DirectBrowserBridgeError
						? error
						: new DirectBrowserBridgeError(
								"unavailable",
								"Browser cookie import disconnected",
							),
					1011,
				),
		});
	}
	isReloadReady(): boolean {
		return this.isReady() && this.peer?.reloadV1 === true;
	}
	pinReload(input: BrowserReloadInput) {
		const peer = this.peer;
		if (!peer || !this.isReloadReady())
			throw new DirectBrowserBridgeError(
				"unavailable",
				"Browser reload bridge is unavailable",
			);
		return this.reload.pin(input, {
			current: () => this.peer === peer && this.isReloadReady(),
			send: (packet) => this.send(peer, packet),
			invalidate: (error) =>
				this.drop(
					peer,
					error instanceof DirectBrowserBridgeError
						? error
						: new DirectBrowserBridgeError(
								"unavailable",
								"Browser reload disconnected",
							),
					1011,
				),
		});
	}
	isNavigationReady(): boolean {
		return this.isReady() && this.peer?.navigateV1 === true;
	}
	pinNavigation(input: BrowserNavigationInput) {
		const peer = this.peer;
		if (!peer || !this.isNavigationReady())
			throw new DirectBrowserBridgeError(
				"unavailable",
				"Browser navigation bridge is unavailable",
			);
		return this.navigation.pin(input, {
			current: () => this.peer === peer && this.isNavigationReady(),
			send: (packet) => this.send(peer, packet),
			invalidate: (error) =>
				this.drop(
					peer,
					error instanceof DirectBrowserBridgeError
						? error
						: new DirectBrowserBridgeError(
								"unavailable",
								"Browser navigation disconnected",
							),
					1011,
				),
		});
	}
	isEvaluationReady(): boolean {
		return this.isReady() && this.peer?.evaluateV1 === true;
	}
	pinEvaluation(input: BrowserEvaluationInput) {
		const peer = this.peer;
		if (!peer || !this.isEvaluationReady())
			throw new DirectBrowserBridgeError(
				"unavailable",
				"Browser evaluation bridge is unavailable",
			);
		return this.evaluation.pin(input, {
			current: () => this.peer === peer && this.isEvaluationReady(),
			send: (packet) => this.send(peer, packet),
			invalidate: (error) =>
				this.drop(
					peer,
					error instanceof DirectBrowserBridgeError
						? error
						: new DirectBrowserBridgeError(
								"unavailable",
								"Browser evaluation disconnected",
							),
					1011,
				),
		});
	}
	isOpenReady(): boolean {
		return (
			this.isReady() && !!this.peer?.openScopeId && this.peer.openAccepting
		);
	}
	pinOpen(
		input: BrowserOpenInput & {
			projectId: string | null;
			workspaceName: string;
		},
	) {
		const peer = this.peer,
			scopeId = peer?.openScopeId;
		if (!peer || !scopeId || !this.isOpenReady())
			throw new DirectBrowserBridgeError(
				"unavailable",
				"Browser open bridge is unavailable",
			);
		return this.openTransfer.pin(
			{ ...input, scopeId },
			{
				current: () =>
					this.peer === peer && peer.ready && peer.openScopeId === scopeId,
				send: (packet) => this.send(peer, packet),
				invalidate: (error) =>
					this.drop(
						peer,
						error instanceof DirectBrowserBridgeError
							? error
							: new DirectBrowserBridgeError(
									"unavailable",
									"Browser open disconnected",
								),
						1011,
					),
			},
		);
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
		const peer: Peer = {
			transport,
			ready: false,
			capturePngV1: false,
			importCookiesV1: false,
			importSourcesV1: false,
			reloadV1: false,
			navigateV1: false,
			evaluateV1: false,
			openV1: false,
			openScopeId: null,
			openAccepting: false,
			cancelHandshake: () => {},
		};
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
		this.capture.disconnect(error);
		this.cookieImportTransfer.disconnect(error);
		this.importSourcesTransfer.disconnect(error);
		this.reload.disconnect(error);
		this.navigation.disconnect(error);
		this.evaluation.disconnect(error);
		this.openTransfer.disconnect(error);
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
				peer.capturePngV1 = packet.features.includes("capturePngV1");
				peer.importCookiesV1 = packet.features.includes("importCookiesV1");
				peer.importSourcesV1 = packet.features.includes("importSourcesV1");
				peer.reloadV1 = packet.features.includes("reloadV1");
				peer.navigateV1 = packet.features.includes("navigateV1");
				peer.evaluateV1 = packet.features.includes("evaluateV1");
				peer.openV1 = packet.features.includes("openV1");
				this.send(peer, {
					type: "ready",
					protocol: 1,
					...this.identity,
					features: [
						"readV1",
						...(peer.capturePngV1 ? ["capturePngV1"] : []),
						...(peer.navigateV1 ? ["navigateV1"] : []),
						...(peer.evaluateV1 ? ["evaluateV1"] : []),
						...(peer.openV1 ? ["openV1"] : []),
						...(peer.reloadV1 ? ["reloadV1"] : []),
						...(peer.importSourcesV1 ? ["importSourcesV1"] : []),
						...(peer.importCookiesV1 ? ["importCookiesV1"] : []),
					],
				});
				return;
			}
			if (packet.type === "open-availability") {
				if (!peer.openV1) throw Error("Open feature was not negotiated");
				const scopeId = packet.ready ? packet.scopeId : null;
				if (peer.openScopeId !== scopeId)
					this.openTransfer.disconnect(
						new DirectBrowserBridgeError(
							"unavailable",
							"Browser open view scope changed",
						),
					);
				peer.openScopeId = scopeId;
				peer.openAccepting = packet.ready && packet.accepting;
				return;
			}
			if (packet.type === "open-result") {
				if (!peer.openV1) throw Error("Open feature was not negotiated");
				this.openTransfer.receive(packet);
				return;
			}
			if (packet.type === "evaluate-result") {
				if (!peer.evaluateV1)
					throw Error("Evaluation feature was not negotiated");
				this.evaluation.receive(packet);
				return;
			}
			if (packet.type === "import-cookies-result") {
				if (!peer.importCookiesV1)
					throw Error("Cookie import feature was not negotiated");
				this.cookieImportTransfer.receive(packet);
				return;
			}
			if (packet.type === "import-sources-result") {
				if (!peer.importSourcesV1)
					throw Error("Login source feature was not negotiated");
				this.importSourcesTransfer.receive(packet);
				return;
			}
			if (packet.type === "reload-result") {
				if (!peer.reloadV1) throw Error("Reload feature was not negotiated");
				this.reload.receive(packet);
				return;
			}
			if (packet.type === "navigate-result") {
				if (!peer.navigateV1)
					throw Error("Navigation feature was not negotiated");
				this.navigation.receive(packet);
				return;
			}
			if (packet.type === "capture-chunk" || packet.type === "capture-done") {
				if (!peer.capturePngV1)
					throw Error("Screenshot feature was not negotiated");
				this.capture.receive(packet);
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

import type { FsWatchEvent } from "@superset/workspace-fs/client";
import { Utf8Base64 } from "renderer/lib/terminal/clipboard-base64";
import {
	createFileDocumentStore,
	type DocumentFilesystemClient,
} from "renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/state/fileDocumentStore/createFileDocumentStore";
import { FileAutoSaveController } from "renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/state/fileDocumentStore/fileAutoSave/fileAutoSave";
import type { SharedFileDocument } from "renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/state/fileDocumentStore/types";
import { isImageFile, isPdfFile, isVideoFile } from "shared/file-types";
import type {
	DirectDescriptor,
	DirectWorkstationApi,
} from "../../../../../shared/direct-workstation";

type Store = ReturnType<typeof createFileDocumentStore>;
type ReadResult = Awaited<
	ReturnType<DocumentFilesystemClient["filesystem"]["readFile"]["query"]>
>;
export interface FileDocumentView {
	activeId: string | null;
	order: string[];
	labels: Record<string, string>;
	revealLines: Record<string, number>;
}
const EMPTY_VIEW: FileDocumentView = {
	activeId: null,
	order: [],
	labels: {},
	revealLines: {},
};
interface Scope {
	views: Map<string, FileDocumentView>;
	descriptor: DirectDescriptor;
	active: boolean;
	store: Store;
	client: DocumentFilesystemClient;
	lineEndings: Map<string, "\n" | "\r\n">;
}
const scopeId = (connection: DirectDescriptor) =>
	JSON.stringify([
		connection.connectionId,
		connection.backendId,
		connection.namespaceId,
	]);

export class WorkstationFileDocuments {
	readonly autoSave = new FileAutoSaveController({
		getDocuments: () =>
			[...this.scopes.values()]
				.filter((scope) => scope.active)
				.flatMap((scope) => scope.store.getDocuments()),
		subscribeDocuments: (listener) => this.subscribe(listener),
	});
	private autoSaveUsers = 0;
	private stopAutoSave: (() => void) | null = null;
	startAutoSave(): () => void {
		if (this.autoSaveUsers++ === 0) {
			const stop = this.autoSave.start();
			const blur = () => this.autoSave.onWindowChange();
			window.addEventListener("blur", blur);
			this.stopAutoSave = () => {
				window.removeEventListener("blur", blur);
				stop();
			};
		}
		return () => {
			if (--this.autoSaveUsers === 0) {
				this.stopAutoSave?.();
				this.stopAutoSave = null;
			}
		};
	}
	private readonly scopes = new Map<string, Scope>();
	private readonly maxDocuments: number;
	private revision = 0;
	private readonly listeners = new Set<() => void>();
	getVersion = () => this.revision;
	subscribe = (listener: () => void) => {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	};
	constructor(
		private readonly api: Pick<DirectWorkstationApi, "rpc">,
		options: { maxDocuments?: number } = {},
	) {
		this.maxDocuments = options.maxDocuments ?? 20;
		if (
			!Number.isSafeInteger(this.maxDocuments) ||
			this.maxDocuments < 1 ||
			this.maxDocuments > 100
		)
			throw new Error("Invalid document limit");
	}
	activate(connection: DirectDescriptor): void {
		const owned = [...this.scopes.entries()].filter(
			([, scope]) => scope.descriptor.connectionId === connection.connectionId,
		);
		if (
			owned.some(
				([, scope]) => connection.generation < scope.descriptor.generation,
			)
		)
			throw new Error("Stale file connection");
		for (const [id, scope] of owned) {
			scope.active = id === scopeId(connection);
			if (scope.active) scope.descriptor = connection;
		}
	}

	private getScope(connection: DirectDescriptor): Scope {
		this.activate(connection);
		const id = scopeId(connection);
		const existing = this.scopes.get(id);
		if (existing) return existing;
		for (const [key, scope] of this.scopes)
			if (scope.store.getDocuments().length === 0) this.scopes.delete(key);
		if (this.scopes.size >= 10)
			throw new Error("Backend document limit reached");
		const store = createFileDocumentStore({
			maxBytes: 1024 * 1024,
			allowUnlimited: false,
		});
		const scope = {
			descriptor: connection,
			active: true,
			store,
			lineEndings: new Map(),
			views: new Map(),
		} as Scope;
		const request = async <T>(
			path: string,
			type: "query" | "mutation",
			input: unknown,
		): Promise<T> => {
			if (!scope.active || !scope.descriptor.capabilities?.files)
				throw new Error("File backend is unavailable");
			const descriptor = scope.descriptor;
			const result = await this.api.rpc<T>({
				connectionId: descriptor.connectionId,
				generation: descriptor.generation,
				path,
				type,
				input,
			});
			if (
				!scope.active ||
				scope.descriptor.generation !== descriptor.generation
			)
				throw new Error("File connection changed");
			return result;
		};
		store.subscribeDocuments(() => {
			const live = new Set(store.getDocuments().map((document) => document.id));
			for (const id of scope.lineEndings.keys())
				if (!live.has(id)) scope.lineEndings.delete(id);
			for (const [workspaceId, view] of scope.views) {
				const owned = store
					.getDocuments()
					.filter((document) => document.workspaceId === workspaceId);
				const ids = new Set(owned.map((document) => document.id));
				if (ids.size === 0) {
					scope.views.delete(workspaceId);
					continue;
				}
				view.order = view.order.filter((id) => ids.has(id));
				for (const id of Object.keys(view.labels))
					if (!ids.has(id)) delete view.labels[id];
				for (const id of Object.keys(view.revealLines))
					if (!ids.has(id)) delete view.revealLines[id];
				if (view.activeId && !ids.has(view.activeId))
					view.activeId = owned[0]?.id ?? null;
			}
			this.revision++;
			for (const listener of this.listeners) listener();
		});
		scope.client = {
			filesystem: {
				readFile: {
					query: async (input) => {
						const requestedDocumentId = store.getDocument(
							input.workspaceId,
							input.absolutePath,
						)?.id;
						const result = await request<ReadResult>(
							"filesystem.readFile",
							"query",
							{ ...input, encoding: undefined, maxBytes: 1024 * 1024 },
						);
						if (
							result.exceededLimit ||
							isImageFile(input.absolutePath) ||
							isVideoFile(input.absolutePath) ||
							isPdfFile(input.absolutePath)
						)
							return result;
						let text: string;
						try {
							text =
								result.kind === "text"
									? result.content
									: new TextDecoder("utf-8", {
											fatal: true,
											ignoreBOM: true,
										}).decode(
											typeof result.content === "string"
												? Uint8Array.from(atob(result.content), (ch) =>
														ch.charCodeAt(0),
													)
												: result.content,
										);
						} catch {
							return result;
						}
						if (text.includes("\0"))
							return result.kind === "bytes"
								? result
								: {
										...result,
										kind: "bytes",
										content: new Utf8Base64().encodeText(text),
									};
						const lineEnding =
							text.includes("\r\n") && !/(^|[^\r])\n/.test(text)
								? "\r\n"
								: "\n";
						const document = store.getDocument(
							input.workspaceId,
							input.absolutePath,
						);
						if (
							document &&
							document.id === requestedDocumentId &&
							!document.dirty
						)
							scope.lineEndings.set(document.id, lineEnding);
						return {
							...result,
							kind: "text",
							content:
								lineEnding === "\r\n" ? text.replaceAll("\r\n", "\n") : text,
						};
					},
				},
				writeFile: {
					mutate: async (input) => {
						if (!input.precondition?.ifMatch)
							throw new Error("A file revision is required for saving");
						const lineEnding = scope.lineEndings.get(
							store.getDocument(input.workspaceId, input.absolutePath)?.id ??
								"",
						);
						const content =
							lineEnding === "\r\n" && typeof input.content === "string"
								? input.content.replaceAll("\n", "\r\n")
								: input.content;
						return await request("filesystem.writeFile", "mutation", {
							...input,
							content,
							options: { create: false, overwrite: true },
						});
					},
				},
			},
		};
		this.scopes.set(id, scope);
		return scope;
	}
	acquire(
		connection: DirectDescriptor,
		workspaceId: string,
		path: string,
	): SharedFileDocument {
		const scope = this.getScope(connection);
		const existing = scope.store.getDocument(workspaceId, path);
		if (
			!existing &&
			[...this.scopes.values()].reduce(
				(sum, entry) => sum + entry.store.getDocuments().length,
				0,
			) >= this.maxDocuments
		)
			throw new Error(
				"Open file limit reached; close a saved file or discard a draft",
			);
		return scope.store.acquireDocument(workspaceId, path, scope.client);
	}
	getView(connection: DirectDescriptor, workspaceId: string): FileDocumentView {
		return (
			this.scopes.get(scopeId(connection))?.views.get(workspaceId) ?? EMPTY_VIEW
		);
	}
	updateView(
		connection: DirectDescriptor,
		workspaceId: string,
		patch: Partial<FileDocumentView>,
	): void {
		const scope = this.scopes.get(scopeId(connection));
		if (!scope) return;
		scope.views.set(workspaceId, {
			...this.getView(connection, workspaceId),
			...patch,
		});
		this.revision++;
		for (const listener of this.listeners) listener();
	}
	getDocuments(
		connection: DirectDescriptor,
		workspaceId: string,
	): SharedFileDocument[] {
		return (
			this.scopes
				.get(scopeId(connection))
				?.store.getDocuments()
				.filter((document) => document.workspaceId === workspaceId) ?? []
		);
	}
	dispatchFsEvent(
		connection: DirectDescriptor,
		workspaceId: string,
		event: FsWatchEvent,
	): void {
		const scope = this.scopes.get(scopeId(connection));
		if (!scope?.active || scope.descriptor.generation !== connection.generation)
			return;
		if (event.kind === "delete" && event.isDirectory) {
			const paths = scope.store
				.getDocuments()
				.filter(
					(document) =>
						document.workspaceId === workspaceId &&
						(document.absolutePath === event.absolutePath ||
							document.absolutePath.startsWith(`${event.absolutePath}/`)),
				)
				.map((document) => document.absolutePath);
			for (const absolutePath of paths)
				scope.store.dispatchFsEvent(workspaceId, {
					...event,
					absolutePath,
					isDirectory: false,
				});
		} else scope.store.dispatchFsEvent(workspaceId, event);
	}

	discard(
		connection: DirectDescriptor,
		workspaceId: string,
		path: string,
	): void {
		const store = this.scopes.get(scopeId(connection))?.store;
		if (!store) return;
		if (!store.discardDocument(workspaceId, path))
			throw new Error("File save is still in progress");
	}

	release(
		connection: DirectDescriptor,
		workspaceId: string,
		path: string,
	): void {
		const scope = this.scopes.get(scopeId(connection));
		if (!scope) return;
		scope.store.releaseDocument(workspaceId, path);
	}
}

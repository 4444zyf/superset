import type {
	ImportedLegacyHistoryChunk,
	ImportedLegacyHistoryPage,
	LegacyDiscovery,
	LegacyImportPreview,
} from "@superset/shared/direct-legacy-data";
import type { BrandLinkId } from "@superset/shared/product-brand";
import type { RestoreResourceRef } from "@superset/shared/workspace-restore";
import type {
	WorkspaceRestoreSnapshot,
	WorkspaceViewInput,
	WorkspaceViewSnapshot,
} from "./workspace-view";

export interface ProductAboutInfo {
	version: string;
	source?: string;
	license: string;
	notice: string;
}

export interface DirectLocalNamespace {
	id: string;
	label: string;
	selected: boolean;
	isDefault: boolean;
	backendId: string;
	namespaceId: string;
}

export interface DirectLocalImportResult {
	destinationNamespaceId: string;
	sourceNamespace: string;
	targetNamespace: string;
	projects: number;
	workspaces: number;
	terminals: number;
	chats: number;
	warnings: string[];
}

export interface DirectLocalDataApi {
	listNamespaces(): Promise<DirectLocalNamespace[]>;
	createNamespace(label: string): Promise<DirectLocalNamespace>;
	selectNamespace(namespaceId: string): Promise<DirectLocalNamespace>;
	removeNamespace(
		namespaceId: string,
	): Promise<undefined | { status: "cancelled" }>;
	discoverLegacySources(): Promise<LegacyDiscovery>;
	previewLegacySources(sourceIds: string[]): Promise<LegacyImportPreview>;
	importSource(input: {
		sourceId: string;
		label?: string;
	}): Promise<DirectLocalImportResult | { status: "cancelled" }>;
	listLegacyHistory(input: {
		namespaceId: string;
		offset?: number;
		limit?: number;
	}): Promise<ImportedLegacyHistoryPage>;
	readLegacyHistory(input: {
		namespaceId: string;
		workspaceId: string;
		terminalId: string;
		byteOffset?: number;
		byteLimit?: number;
	}): Promise<ImportedLegacyHistoryChunk>;
}

export interface DirectProfile {
	id: string;
	kind?: "ssh" | "local";
	name: string;
	host: string;
	port?: number;
	user?: string;
	identityFile?: string;
	backendId?: string;
	namespaceId?: string;
	serviceUid?: number;
}

export interface DirectDescriptor {
	connectionId: string;
	generation: number;
	backendId: string;
	namespaceId: string;
	instanceId: string;
	capabilities?: Record<string, boolean>;
	chatHarnesses?: { id: string; available: boolean; reason?: string }[];
}

export interface DirectSetupSnapshot {
	connectionId: string;
	jobId: string;
	generation: number;
	sequence: number;
	status: "running" | "completed" | "failed";
	phase:
		| "connecting"
		| "probing"
		| "checking-release"
		| "preparing-upload"
		| "uploading"
		| "installing"
		| "forwarding"
		| "verifying";
	elapsedMs: number;
	steps: { phase: DirectSetupSnapshot["phase"]; elapsedMs: number }[];
}

export interface DirectRpc {
	connectionId: string;
	generation: number;
	path: string;
	type: "query" | "mutation";
	input?: unknown;
}

export interface DirectSocketEvent {
	socketId: string;
	kind: "open" | "message" | "close" | "error";
	data?: string | Uint8Array;
}

export type DirectConnectionEvent =
	| {
			kind: "reconnecting";
			connectionId: string;
			previousGeneration: number;
			attempt: number;
	  }
	| {
			kind: "connected";
			connectionId: string;
			previousGeneration: number;
			descriptor: DirectDescriptor;
	  }
	| {
			kind: "blocked";
			connectionId: string;
			previousGeneration: number;
			error: string;
	  };

export interface DirectWorkstationApi {
	getWorkspaceView?(): Promise<{
		revision: number;
		snapshot: WorkspaceViewSnapshot | null;
		invalid: boolean;
		navigationRevision: number;
	}>;
	saveWorkspaceView?(input: {
		expectedRevision: number;
		navigationRevision: number;
		view: WorkspaceViewInput;
	}): Promise<WorkspaceViewSnapshot>;
	beginWorkspaceRestore?(input: {
		reason: "launch" | "manual";
		navigationRevision: number;
	}): Promise<WorkspaceRestoreSnapshot>;
	getWorkspaceRestore?(): Promise<WorkspaceRestoreSnapshot | null>;
	onWorkspaceRestore?(
		listener: (snapshot: WorkspaceRestoreSnapshot) => void,
	): () => void;
	cancelWorkspaceRestore?(input: { restoreJobId: string }): Promise<void>;
	forgetWorkspaceView?(input: { expectedRevision: number }): Promise<void>;
	onWorkspaceViewFlush?(listener: () => Promise<void>): () => void;
	inspectPending?(id: string): Promise<unknown[]>;
	openRestoredTerminal?(
		connection: DirectDescriptor,
		ref: RestoreResourceRef,
		socketId: string,
	): Promise<void>;
	about(): Promise<ProductAboutInfo>;
	openBrandLink(id: BrandLinkId): Promise<void>;
	readonly platform: string;
	readonly localData?: DirectLocalDataApi;
	list(): Promise<DirectProfile[]>;
	save(profile: DirectProfile): Promise<DirectProfile>;
	remove(id: string): Promise<void>;
	test(id: string): Promise<unknown>;
	testProfile(
		profile: DirectProfile,
	): Promise<{ platform: string; architecture: string; installed: boolean }>;
	connect(id: string, password?: string): Promise<DirectDescriptor>;
	getSetupSnapshot?(id: string): Promise<DirectSetupSnapshot | null>;
	onSetup?(listener: (snapshot: DirectSetupSnapshot) => void): () => void;
	refreshFeatures(connection: DirectDescriptor): Promise<DirectDescriptor>;
	disconnect(id: string): Promise<void>;
	selectRelease(id: string): Promise<boolean>;
	importLocalData(id: string): Promise<unknown>;
	listPending(
		id: string,
	): Promise<{ operationId: string; procedure: string }[]>;
	reconcile(id: string): Promise<unknown[]>;
	acknowledge(
		connection: DirectDescriptor,
		operationId: string,
	): Promise<boolean>;
	chooseAttachment(connection: DirectDescriptor): Promise<{
		attachmentId: string;
		originalFilename?: string;
		mediaType: string;
		sizeBytes: number;
	} | null>;
	readAttachment(
		connection: DirectDescriptor,
		attachmentId: string,
	): Promise<{ bytes: Uint8Array; mimeType: string; fileName: string }>;
	openPort(
		connection: DirectDescriptor,
		workspaceId: string,
		port: number,
	): Promise<{ id: string; url: string }>;
	closePort(id: string): Promise<void>;
	control(
		id: string,
		action: "install" | "activate" | "start" | "stop" | "repair" | "uninstall",
		password?: string,
	): Promise<unknown>;
	rpc<T>(request: DirectRpc): Promise<T>;
	openSocket(
		connection: DirectDescriptor,
		path: string,
		socketId: string,
	): Promise<void>;
	sendSocket(socketId: string, data: string): Promise<void>;
	closeSocket(socketId: string): Promise<void>;
	onSocket(listener: (event: DirectSocketEvent) => void): () => void;
	onConnection(listener: (event: DirectConnectionEvent) => void): () => void;
}

export const DIRECT_CHANNEL = "direct-workstation";
export const DIRECT_SOCKET_CHANNEL = "direct-workstation:socket";
export const DIRECT_CONNECTION_CHANNEL = "direct-workstation:connection";
export const DIRECT_SETUP_CHANNEL = "direct-workstation:setup";
export const DIRECT_RESTORE_CHANNEL = "direct-workstation:restore";
export const DIRECT_VIEW_FLUSH_CHANNEL = "direct-workstation:flush-view";

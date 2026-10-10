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
	readonly platform: string;
	list(): Promise<DirectProfile[]>;
	save(profile: DirectProfile): Promise<DirectProfile>;
	remove(id: string): Promise<void>;
	test(id: string): Promise<unknown>;
	connect(id: string, password?: string): Promise<DirectDescriptor>;
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

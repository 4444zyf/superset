export interface LegacySource {
	id: string;
	format: "v1" | "v2";
	sourceDirectory: string;
	sourceNamespace: string;
}
export interface LegacyDiscovery {
	sources: LegacySource[];
	issues: Array<{
		path: string;
		reason:
			| "symlink"
			| "foreign-owner"
			| "unreadable"
			| "not-directory"
			| "not-regular"
			| "limit";
	}>;
}
export interface LegacyConflict {
	kind:
		| "project-id"
		| "workspace-id"
		| "terminal-id"
		| "chat-id"
		| "repository-path"
		| "workspace-path";
	value: string;
	sourceIds: string[];
	entityIds: string[];
}
export interface LegacyImportPreview {
	sources: Array<{
		source: LegacySource;
		status: "ready" | "blocked";
		counts?: {
			projects: number;
			workspaces: number;
			terminals: number;
			chats: number;
		};
		reason?: string;
	}>;
	conflicts: LegacyConflict[];
	conflictCount: number;
	conflictsTruncated: boolean;
	strategy: "separate-namespaces";
}
export interface ImportedLegacyHistoryEntry {
	kind: "static";
	workspaceId: string;
	terminalId: string;
	cwd: string;
	cols: number;
	rows: number;
	startedAt: string;
	endedAt?: string;
	agentId?: string;
	agentSessionId?: string;
}
export interface ImportedLegacyHistoryPage {
	entries: ImportedLegacyHistoryEntry[];
	total: number;
	nextOffset?: number;
}
export interface ImportedLegacyHistoryChunk {
	kind: "static";
	workspaceId: string;
	terminalId: string;
	text: string;
	byteOffset: number;
	nextByteOffset?: number;
	totalBytes: number;
}
export type LocalDataQuery =
	| { action: "discover"; userHomeDirectory: string }
	| { action: "preview"; sources: LegacySource[] }
	| { action: "listHistory"; offset?: number; limit?: number }
	| {
			action: "readHistory";
			workspaceId: string;
			terminalId: string;
			byteOffset?: number;
			byteLimit?: number;
	  };

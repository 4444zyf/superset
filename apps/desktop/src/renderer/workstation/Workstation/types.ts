export type {
	DirectDescriptor,
	DirectLocalNamespace,
	DirectProfile,
	DirectWorkstationApi,
} from "../../../shared/direct-workstation";

export interface RemoteWorkspace {
	id: string;
	name: string;
	worktreePath: string;
	projectId?: string | null;
}
export interface RemoteProject {
	id: string;
	name: string;
	repoPath: string;
}
export interface RemoteDirectory {
	path: string;
	parentPath: string | null;
	entries: { name: string; isDirectory: boolean; isSymlink: boolean }[];
}
export type ControlAction =
	| "install"
	| "activate"
	| "start"
	| "stop"
	| "repair"
	| "uninstall";
export interface MachineSnapshot {
	projects: RemoteProject[];
	workspaces: RemoteWorkspace[];
	backendId: string;
	namespaceId: string;
	syncedAt: number;
}
export interface MachineProbe {
	platform: string;
	architecture: string;
	installed: boolean;
}

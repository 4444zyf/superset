import type { HostAgentConfig } from "@superset/host-service/settings";
import type {
	DirectDescriptor,
	DirectWorkstationApi,
} from "../../../../../shared/direct-workstation";
export interface RemoteTerminalScriptsProps {
	api: DirectWorkstationApi;
	connection: DirectDescriptor;
	workspaceId: string;
	agents: HostAgentConfig[];
	busy: boolean;
}

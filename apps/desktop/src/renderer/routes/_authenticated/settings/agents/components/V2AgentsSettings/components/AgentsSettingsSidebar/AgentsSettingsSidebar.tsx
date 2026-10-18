import { AgentIcon } from "../AgentIcon";
import {
	type AgentsSettingsSidebarProps,
	AgentsSettingsSidebarView,
} from "./components/AgentsSettingsSidebarView/AgentsSettingsSidebarView";
export function AgentsSettingsSidebar(props: AgentsSettingsSidebarProps) {
	return (
		<AgentsSettingsSidebarView
			{...props}
			renderIcon={(icon) => <AgentIcon {...icon} />}
		/>
	);
}

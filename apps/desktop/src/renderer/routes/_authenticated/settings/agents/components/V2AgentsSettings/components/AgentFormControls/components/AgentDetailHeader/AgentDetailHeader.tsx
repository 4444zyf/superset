import { AgentIcon } from "../../../AgentIcon";
import { AgentDetailHeaderView } from "../AgentDetailHeaderView/AgentDetailHeaderView";
export function AgentDetailHeader({
	iconId,
	presetId,
	title,
	subtitle,
}: {
	iconId?: string | null;
	presetId: string;
	title: string;
	subtitle: string;
}) {
	return (
		<AgentDetailHeaderView
			title={title}
			subtitle={subtitle}
			icon={
				<AgentIcon iconId={iconId} presetId={presetId} className="size-8" />
			}
		/>
	);
}

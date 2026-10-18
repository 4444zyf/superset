import { useLingui } from "@lingui/react/macro";
import { AgentDetailHeader } from "../AgentFormControls";
import { AgentIconPicker } from "../AgentIconPicker";
import {
	type NewCustomAgentDetailProps,
	NewCustomAgentDetailView,
} from "./components/NewCustomAgentDetailView/NewCustomAgentDetailView";

export type { CreateCustomAgentInput } from "./components/NewCustomAgentDetailView/NewCustomAgentDetailView";
export function NewCustomAgentDetail(props: NewCustomAgentDetailProps) {
	const { t } = useLingui();
	return (
		<NewCustomAgentDetailView
			{...props}
			renderHeader={(iconId, title) => (
				<AgentDetailHeader
					iconId={iconId}
					presetId="custom"
					title={title}
					subtitle={t({
						message: "Add your own terminal agent to this device.",
					})}
				/>
			)}
			renderIconPicker={(value, onChange, disabled) => (
				<AgentIconPicker
					value={value}
					onChange={onChange}
					disabled={disabled}
				/>
			)}
		/>
	);
}

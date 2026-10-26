import { usePresetIcon } from "renderer/assets/app-icons/preset-icons";
import {
	ExistingSessionOptionView,
	type ExistingSessionOptionViewProps,
} from "./components/ExistingSessionOptionView";

export function ExistingSessionOption(
	props: Omit<ExistingSessionOptionViewProps, "iconSrc">,
) {
	const iconSrc = usePresetIcon(props.binding.agentId);
	return <ExistingSessionOptionView {...props} iconSrc={iconSrc} />;
}

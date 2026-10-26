import { usePresetIcon } from "renderer/assets/app-icons/preset-icons";
import {
	NewSessionOptionView,
	type NewSessionOptionViewProps,
} from "./components/NewSessionOptionView";

export function NewSessionOption(
	props: Omit<NewSessionOptionViewProps, "iconSrc">,
) {
	const iconSrc = usePresetIcon(props.presetId);
	return <NewSessionOptionView {...props} iconSrc={iconSrc} />;
}

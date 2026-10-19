import { useIsDarkTheme } from "renderer/assets/app-icons/preset-icons";
import {
	type PresetRowProps,
	PresetRowView,
} from "./components/PresetRowView/PresetRowView";
export function PresetRow(props: PresetRowProps) {
	return <PresetRowView {...props} isDark={useIsDarkTheme()} />;
}

import { useIsDarkTheme } from "renderer/assets/app-icons/preset-icons";
import {
	type PresetsTableProps,
	PresetsTableView,
} from "./components/PresetsTableView/PresetsTableView";
export function PresetsTable(props: PresetsTableProps) {
	return <PresetsTableView {...props} isDark={useIsDarkTheme()} />;
}

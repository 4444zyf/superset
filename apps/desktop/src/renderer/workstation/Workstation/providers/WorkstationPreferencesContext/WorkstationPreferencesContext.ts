import { darkTheme, getBuiltInTheme } from "@superset/shared/themes";
import { createContext, useContext } from "react";
import type { WorkstationPreferenceSnapshot } from "../../../../../shared/workstation-preferences";

export const WorkstationPreferencesContext =
	createContext<WorkstationPreferenceSnapshot | null>(null);
export function useWorkstationAppearance() {
	const values = useContext(WorkstationPreferencesContext)?.values;
	return {
		theme: getBuiltInTheme(values?.themeId ?? "dark") ?? darkTheme,
		fontSettings: values?.fontSettings,
		copyOnSelect: values?.terminalCopyOnSelect ?? false,
	};
}

import type { SupportedLocale } from "@superset/i18n/locales";
import type {
	FileAutoSaveMode,
	FileOpenMode,
} from "@superset/shared/file-settings";
import type { SetFontSettingsInput } from "lib/trpc/routers/settings/font-settings.utils";

export interface WorkstationPreferenceValues {
	agentNativeInputEnabled: boolean;
	language: SupportedLocale | null;
	themeId: string;
	fontSettings: SetFontSettingsInput;
	fileOpenMode: FileOpenMode;
	fileAutoSave: FileAutoSaveMode;
	confirmOnQuit: boolean;
	terminalCopyOnSelect: boolean;
}
export type WorkstationPreferencePatch = Partial<WorkstationPreferenceValues>;
export interface WorkstationPreferenceSnapshot {
	revision: number;
	invalid: boolean;
	values: WorkstationPreferenceValues;
}

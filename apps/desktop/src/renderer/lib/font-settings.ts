import type { ElectronRouterOutputs } from "./electron-trpc";

export const FONT_SETTINGS_QUERY_KEY = [
	"electron",
	"settings",
	"getFontSettings",
] as const;

export type FontSettings = ElectronRouterOutputs["settings"]["getFontSettings"];

export const EMPTY_FONT_SETTINGS: FontSettings = {
	terminalFontFamily: null,
	terminalFontSize: null,
	terminalLineHeight: null,
	terminalLetterSpacing: null,
	terminalFontWeight: null,
	terminalLigatures: null,
	terminalMinimumContrast: null,
	terminalCursorStyle: null,
	terminalCursorBlink: null,
	editorFontFamily: null,
	editorFontSize: null,
	editorLineHeight: null,
	editorLetterSpacing: null,
	editorFontWeight: null,
	editorLigatures: null,
};

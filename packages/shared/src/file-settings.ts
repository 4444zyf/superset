export const FILE_OPEN_MODES = ["split-pane", "new-tab"] as const;
export type FileOpenMode = (typeof FILE_OPEN_MODES)[number];

export const FILE_AUTO_SAVE_MODES = [
	"off",
	"afterDelay",
	"onFocusChange",
	"onWindowChange",
] as const;
export type FileAutoSaveMode = (typeof FILE_AUTO_SAVE_MODES)[number];

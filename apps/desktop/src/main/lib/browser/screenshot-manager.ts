import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { app, shell } from "electron";
import { localDb } from "../local-db";
import { ScreenshotManagerCore } from "./screenshot-manager-core";
export const screenshotManager = new ScreenshotManagerCore(localDb, {
	directory: () => {
		const dir = join(app.getPath("pictures"), "Superset Screenshots");
		mkdirSync(dir, { recursive: true });
		return dir;
	},
	showInFolder: (path) => shell.showItemInFolder(path),
	openFile: (path) => shell.openPath(path),
});

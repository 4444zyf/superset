import { app, session, shell } from "electron";
import { localDb } from "../local-db";
import { DownloadManagerCore } from "./download-manager-core";
export const downloadManager = new DownloadManagerCore(localDb, {
	session: () => session.fromPartition("persist:superset"),
	directory: () => app.getPath("downloads"),
	showInFolder: (path) => shell.showItemInFolder(path),
	openFile: (path) => shell.openPath(path),
});

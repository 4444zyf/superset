import type { ScreenshotsSource } from "renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/hooks/usePaneRegistry/components/BrowserPane/components/ScreenshotsDialog/components/ScreenshotsDialogView";
import type { WorkstationScreenshotsApi } from "shared/workstation-browser";
import { subscribeBrowserSnapshot } from "../browser-snapshot/browser-snapshot";
export function screenshotsSource(
	api: WorkstationScreenshotsApi,
	copyText: (text: string) => Promise<void>,
): ScreenshotsSource {
	return {
		subscribe: (onData, onError) =>
			subscribeBrowserSnapshot(api, onData, onError),
		open: (id) => api.open({ id }),
		showInFolder: (id) => api.showInFolder({ id }),
		clear: () => api.clear(),
		copyPath: copyText,
	};
}

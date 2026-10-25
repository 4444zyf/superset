import { subscribeBrowserSnapshot } from "../browser-snapshot/browser-snapshot";
import type { DownloadsSource } from "renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/hooks/usePaneRegistry/components/BrowserPane/components/DownloadsDialog/components/DownloadsDialogView";
import type { WorkstationDownloadsApi } from "shared/workstation-browser";
export function downloadsSource(api: WorkstationDownloadsApi): DownloadsSource {
	return {
		subscribe: (onData, onError) =>
			subscribeBrowserSnapshot(api, onData, onError),
		cancel: (id) => api.cancel({ id }),
		open: (id) => api.open({ id }),
		showInFolder: (id) => api.showInFolder({ id }),
		clear: () => api.clear(),
	};
}

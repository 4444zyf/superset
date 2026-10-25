import type { DownloadsSource } from "renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/hooks/usePaneRegistry/components/BrowserPane/components/DownloadsDialog/components/DownloadsDialogView";
import type {
	WorkstationDownloadsApi,
	WorkstationDownloadsSnapshot,
} from "shared/workstation-browser";
export function downloadsSource(api: WorkstationDownloadsApi): DownloadsSource {
	return {
		subscribe(onData, onError) {
			let active = true,
				revision = -1;
			const accept = (snapshot: WorkstationDownloadsSnapshot) => {
				if (!active || snapshot.revision < revision) return;
				revision = snapshot.revision;
				onData(snapshot.rows);
			};
			const stop = api.onChanged(accept);
			void api.getSnapshot().then(accept, () => {
				if (active && revision < 0) onError();
			});
			return () => {
				active = false;
				stop();
			};
		},
		cancel: (id) => api.cancel({ id }),
		open: (id) => api.open({ id }),
		showInFolder: (id) => api.showInFolder({ id }),
		clear: () => api.clear(),
	};
}

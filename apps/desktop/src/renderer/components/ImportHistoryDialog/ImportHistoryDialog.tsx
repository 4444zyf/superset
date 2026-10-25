import { useMemo } from "react";
import { electronTrpcClient } from "renderer/lib/trpc-client";
import {
	BROWSER_IMPORT_BANNER_ID,
	useBrowserImportBannerDismissalsStore,
} from "renderer/stores/browser-import-banner-dismissals";
import {
	ImportHistoryDialogView,
	type BrowserImportDataSource,
} from "./components/ImportHistoryDialogView";
export function ImportHistoryDialog(props: {
	open: boolean;
	onOpenChange(open: boolean): void;
}) {
	const dismiss = useBrowserImportBannerDismissalsStore((s) => s.dismiss);
	const source = useMemo<BrowserImportDataSource>(
		() => ({
			getSources: () =>
				electronTrpcClient.browserHistory.getImportSources.query(),
			importHistory: (input) =>
				electronTrpcClient.browserHistory.importFromSource.mutate(input),
			importCookies: (input) =>
				electronTrpcClient.browserHistory.importCookiesFromSource.mutate(input),
			requestFullDiskAccess: () =>
				electronTrpcClient.permissions.requestFullDiskAccess.mutate(),
			onImported: () => dismiss(BROWSER_IMPORT_BANNER_ID),
		}),
		[dismiss],
	);
	return <ImportHistoryDialogView {...props} source={source} />;
}

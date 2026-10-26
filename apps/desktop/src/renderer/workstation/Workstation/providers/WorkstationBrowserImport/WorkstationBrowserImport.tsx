import {
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useState,
} from "react";
import { ImportHistoryDialogView } from "renderer/components/ImportHistoryDialog/components/ImportHistoryDialogView";
import {
	BROWSER_IMPORT_BANNER_ID,
	useBrowserImportBannerDismissalsStore,
} from "renderer/stores/browser-import-banner-dismissals";
import type { BrowserImportApi } from "shared/browser-import";

const BrowserImportContext = createContext<(() => void) | null>(null);
export function useWorkstationBrowserImport() {
	return useContext(BrowserImportContext);
}
export function WorkstationBrowserImport({
	source,
	children,
}: {
	source?: BrowserImportApi;
	children: ReactNode;
}) {
	const dismissBanner = useBrowserImportBannerDismissalsStore(
		(state) => state.dismiss,
	);
	const importSource = useMemo(
		() =>
			source
				? {
						getSources: () => source.getSources(),
						importHistory: (input: { sourceId: string }) =>
							source.importHistory(input),
						importCookies: (input: { sourceId: string }) =>
							source.importCookies(input),
						requestFullDiskAccess: () => source.requestFullDiskAccess(),
						onImported: () => dismissBanner(BROWSER_IMPORT_BANNER_ID),
					}
				: null,
		[source, dismissBanner],
	);
	const [openSource, setOpenSource] = useState<BrowserImportApi | null>(null);
	const show = useCallback(() => {
		if (source) setOpenSource(source);
	}, [source]);
	useEffect(() => {
		if (openSource && openSource !== source) setOpenSource(null);
	}, [source, openSource]);
	return (
		<BrowserImportContext value={source ? show : null}>
			{children}
			{importSource && (
				<ImportHistoryDialogView
					source={importSource}
					open={openSource === source}
					onOpenChange={(next) => setOpenSource(next ? (source ?? null) : null)}
				/>
			)}
		</BrowserImportContext>
	);
}

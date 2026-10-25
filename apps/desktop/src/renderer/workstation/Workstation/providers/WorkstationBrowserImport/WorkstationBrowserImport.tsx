import {
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useEffect,
	useState,
} from "react";
import { ImportHistoryDialogView } from "renderer/components/ImportHistoryDialog/components/ImportHistoryDialogView";
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
			{source && (
				<ImportHistoryDialogView
					source={source}
					open={openSource === source}
					onOpenChange={(next) => setOpenSource(next ? source : null)}
				/>
			)}
		</BrowserImportContext>
	);
}

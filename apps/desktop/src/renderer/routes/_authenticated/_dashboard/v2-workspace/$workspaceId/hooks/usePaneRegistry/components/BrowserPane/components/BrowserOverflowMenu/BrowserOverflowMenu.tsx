import { openAfterClose } from "./utils/openAfterClose/openAfterClose";
import { BrowserOverflowMenuView } from "./components/BrowserOverflowMenuView";
import { useScreenshotToast } from "../../hooks/useScreenshotToast/useScreenshotToast";

import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { ImportHistoryDialog } from "renderer/components/ImportHistoryDialog";
import { useCopyToClipboard } from "renderer/hooks/useCopyToClipboard";
import { electronTrpcClient } from "renderer/lib/trpc-client";
import { browserRuntimeRegistry } from "../../browserRuntimeRegistry";
import { ClearBrowsingDataDialog } from "../ClearBrowsingDataDialog";
import { DownloadsDialog } from "../DownloadsDialog";
import { HistoryDialog } from "../HistoryDialog";
import { ScreenshotsDialog } from "../ScreenshotsDialog";
import { SignedInSitesSubmenu } from "../SignedInSitesSubmenu";

interface BrowserOverflowMenuProps {
	paneId: string;
	currentUrl: string;
	hasPage: boolean;
	zoomFactor: number;
	isDeviceToolbarOpen: boolean;
	onToggleDeviceToolbar: () => void;
	onOpenFindBar: () => void;
	onNavigateToUrl: (url: string) => void;
}

export function BrowserOverflowMenu({
	paneId,
	currentUrl,
	hasPage,
	zoomFactor,
	isDeviceToolbarOpen,
	onToggleDeviceToolbar,
	onOpenFindBar,
	onNavigateToUrl,
}: BrowserOverflowMenuProps) {
	const { copyToClipboard } = useCopyToClipboard();
	const navigate = useNavigate();
	const [isImportOpen, setIsImportOpen] = useState(false);
	const [isHistoryOpen, setIsHistoryOpen] = useState(false);
	const [isDownloadsOpen, setIsDownloadsOpen] = useState(false);
	const [isScreenshotsOpen, setIsScreenshotsOpen] = useState(false);
	const [isClearDataOpen, setIsClearDataOpen] = useState(false);
	const [isMenuOpen, setIsMenuOpen] = useState(false);

	const handleOpenDevTools = () => {
		electronTrpcClient.browser.openDevTools.mutate({ paneId }).catch(() => {});
	};

	const handlePrint = () => browserRuntimeRegistry.print(paneId);

	const handleZoomOut = () => browserRuntimeRegistry.stepZoom(paneId, "out");

	const handleZoomIn = () => browserRuntimeRegistry.stepZoom(paneId, "in");

	const handleZoomReset = () =>
		browserRuntimeRegistry.stepZoom(paneId, "reset");

	const screenshotToast = useScreenshotToast(
		openAfterClose(setIsScreenshotsOpen),
	);
	const handleScreenshot = () => {
		void electronTrpcClient.browser.screenshot
			.mutate({ paneId })
			.then(
				({ base64 }) => screenshotToast.success(base64),
				screenshotToast.error,
			);
	};

	const handleHardReload = () => {
		electronTrpcClient.browser.reload
			.mutate({ paneId, hard: true })
			.catch(() => {});
	};

	const handleCopyUrl = () => {
		if (currentUrl) copyToClipboard(currentUrl);
	};

	const handleOpenExternal = () => {
		if (currentUrl) {
			electronTrpcClient.external.openUrl.mutate(currentUrl).catch(() => {});
		}
	};

	const handleOpenSettings = () => {
		void navigate({ to: "/settings/browser" });
	};

	return (
		<>
			<BrowserOverflowMenuView
				paneId={paneId}
				isMenuOpen={isMenuOpen}
				setIsMenuOpen={setIsMenuOpen}
				hasPage={hasPage}
				zoomFactor={zoomFactor}
				isDeviceToolbarOpen={isDeviceToolbarOpen}
				onOpenFindBar={onOpenFindBar}
				handlePrint={handlePrint}
				handleOpenDevTools={handleOpenDevTools}
				onToggleDeviceToolbar={onToggleDeviceToolbar}
				handleScreenshot={handleScreenshot}
				handleHardReload={handleHardReload}
				handleCopyUrl={handleCopyUrl}
				handleOpenExternal={handleOpenExternal}
				handleOpenSettings={handleOpenSettings}
				handleZoomOut={handleZoomOut}
				handleZoomIn={handleZoomIn}
				handleZoomReset={handleZoomReset}
				onImport={openAfterClose(setIsImportOpen)}
				onDownloads={openAfterClose(setIsDownloadsOpen)}
				onScreenshots={openAfterClose(setIsScreenshotsOpen)}
				onHistory={openAfterClose(setIsHistoryOpen)}
				onClearData={openAfterClose(setIsClearDataOpen)}
				signedInSites={<SignedInSitesSubmenu />}
			/>
			<ImportHistoryDialog open={isImportOpen} onOpenChange={setIsImportOpen} />
			<HistoryDialog
				open={isHistoryOpen}
				onOpenChange={setIsHistoryOpen}
				onSelect={onNavigateToUrl}
			/>
			<DownloadsDialog
				open={isDownloadsOpen}
				onOpenChange={setIsDownloadsOpen}
			/>
			<ScreenshotsDialog
				open={isScreenshotsOpen}
				onOpenChange={setIsScreenshotsOpen}
			/>
			<ClearBrowsingDataDialog
				open={isClearDataOpen}
				onOpenChange={setIsClearDataOpen}
			/>
		</>
	);
}

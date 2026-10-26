import { DesignModeButton } from "./components/DesignModeButton";
import type { RendererContext } from "@superset/panes";
import { useCallback } from "react";
import { OpenBrowserPageInAppButton } from "renderer/components/OpenBrowserPageInAppButton";
import type { PaneViewerData } from "../../../../../../types";
import { browserRuntimeRegistry } from "../../browserRuntimeRegistry";
import { designModeStore, useDesignModeState } from "../../designModeStore";
import {
	deviceToolbarStore,
	useDeviceToolbarState,
} from "../../deviceToolbarStore";
import { findBarStore } from "../../findBarStore";
import { useBrowserState } from "../../hooks/useBrowserState";
import { BrowserOverflowMenu } from "../BrowserOverflowMenu";
import { BrowserToolbar } from "../BrowserToolbar";
import { replaceBrowserPane } from "./utils/replaceBrowserPane";

interface BrowserPaneToolbarProps {
	ctx: RendererContext<PaneViewerData>;
}

export function BrowserPaneToolbar({ ctx }: BrowserPaneToolbarProps) {
	const paneId = ctx.pane.id;
	const state = useBrowserState(paneId);
	const designMode = useDesignModeState(paneId);
	const deviceToolbar = useDeviceToolbarState(paneId);

	const handleToggleDesignMode = useCallback(() => {
		designModeStore.toggle(paneId);
	}, [paneId]);

	const handleGoBack = useCallback(() => {
		browserRuntimeRegistry.goBack(paneId);
	}, [paneId]);

	const handleGoForward = useCallback(() => {
		browserRuntimeRegistry.goForward(paneId);
	}, [paneId]);

	const handleReload = useCallback(() => {
		browserRuntimeRegistry.reload(paneId);
	}, [paneId]);

	const handleNavigate = useCallback(
		(url: string) => {
			browserRuntimeRegistry.navigate(paneId, url);
		},
		[paneId],
	);

	const isBlankPage = !state.currentUrl || state.currentUrl === "about:blank";

	return (
		<div className="@container/browser-toolbar flex h-full w-full min-w-0 items-center justify-between">
			<BrowserToolbar
				paneId={paneId}
				currentUrl={state.currentUrl}
				faviconUrl={state.faviconUrl}
				isLoading={state.isLoading}
				canGoBack={state.canGoBack}
				canGoForward={state.canGoForward}
				onGoBack={handleGoBack}
				onGoForward={handleGoForward}
				onReload={handleReload}
				onNavigate={handleNavigate}
			/>
			<div className="flex shrink-0 items-center gap-1 pr-1.5">
				<OpenBrowserPageInAppButton
					currentUrl={state.currentUrl}
					onOpenInPane={(newPane) =>
						replaceBrowserPane(ctx.store, ctx.tab.id, paneId, newPane)
					}
				/>
				<DesignModeButton
					active={designMode.phase !== "idle"}
					disabled={isBlankPage}
					onToggle={handleToggleDesignMode}
				/>
				<BrowserOverflowMenu
					paneId={paneId}
					currentUrl={state.currentUrl}
					hasPage={!isBlankPage}
					zoomFactor={state.zoomFactor}
					isDeviceToolbarOpen={deviceToolbar.isOpen}
					onToggleDeviceToolbar={() => deviceToolbarStore.toggle(paneId)}
					onOpenFindBar={() => findBarStore.open(paneId)}
					onNavigateToUrl={handleNavigate}
				/>
				{ctx.headerActions}
			</div>
		</div>
	);
}

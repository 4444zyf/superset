import { DesignModeBanner } from "./components/DesignModeBanner";
import { useDesignModePane } from "./hooks/useDesignModePane/useDesignModePane";
import { useBrowserImportSource } from "./components/ChromeImportBanner/hooks/useBrowserImportSource";
import { Trans, useLingui } from "@lingui/react/macro";
import type { RendererContext, Tab } from "@superset/panes";
import { useParams } from "@tanstack/react-router";
import { GlobeIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ImportHistoryDialog } from "renderer/components/ImportHistoryDialog";
import { electronTrpcClient } from "renderer/lib/trpc-client";
import {
	BROWSER_IMPORT_BANNER_ID,
	useBrowserImportBannerDismissalsStore,
} from "renderer/stores/browser-import-banner-dismissals";
import type { BrowserPaneData, PaneViewerData } from "../../../../types";

import { BrowserErrorOverlay } from "./components/BrowserErrorOverlay";
import { BrowserFindBar } from "./components/BrowserFindBar";
import { BrowserTabFavicon } from "./components/BrowserTabFavicon";
import { ChromeImportBanner } from "./components/ChromeImportBanner";
import { DesignModePopover } from "./components/DesignModePopover";
import { DeviceToolbar } from "./components/DeviceToolbar";
import { getDeviceToolbarSize } from "./deviceToolbarStoreCore";
import { BrowserViewportView } from "./components/BrowserViewportView";
import { designModeStore } from "./designModeStore";
import {
	deviceToolbarStore,
	useDeviceToolbarState,
} from "./deviceToolbarStore";
import { findBarStore, useFindBarOpen } from "./findBarStore";
import { useBrowserState } from "./hooks/useBrowserState";
import { usePersistentWebview } from "./hooks/usePersistentWebview";

const browserImportSources = {
	getSources: () => electronTrpcClient.browserHistory.getImportSources.query(),
};

function getSingleBrowserPane(
	tab: Tab<PaneViewerData>,
): { id: string; data: BrowserPaneData } | null {
	const paneIds = Object.keys(tab.panes);
	if (paneIds.length !== 1) return null;
	const pane = tab.panes[paneIds[0]];
	if (pane.kind !== "browser") return null;
	return { id: pane.id, data: pane.data as BrowserPaneData };
}

export function renderBrowserTabIcon(tab: Tab<PaneViewerData>) {
	const browser = getSingleBrowserPane(tab);
	if (!browser) return null;
	const faviconUrl = browser.data.faviconUrl ?? null;
	// Keyed by page + favicon URL so a failed favicon retries on navigation
	// even when the favicon URL itself is unchanged.
	return (
		<BrowserTabFavicon
			key={`${browser.data.url}|${faviconUrl ?? "none"}`}
			src={faviconUrl}
		/>
	);
}

interface CreateNewAgentSessionInput {
	configId: string;
	placement: "split-pane" | "new-tab";
	prompt: string;
}

interface BrowserPaneProps {
	ctx: RendererContext<PaneViewerData>;
	onCreateNewAgentSession?: (
		input: CreateNewAgentSessionInput,
	) => Promise<{ terminalId: string } | null>;
	/** Bring the pane hosting this agent terminal to the front. */
	onFocusAgentTerminal?: (terminalId: string) => void;
}

export function BrowserPane({
	ctx,
	onCreateNewAgentSession,
	onFocusAgentTerminal,
}: BrowserPaneProps) {
	const { t } = useLingui();
	const paneId = ctx.pane.id;
	const state = useBrowserState(paneId);
	const { placeholderRef, reload, overlayContainer } = usePersistentWebview({
		paneId,
		ctx,
	});
	const { workspaceId } = useParams({ strict: false });

	const isFindBarOpen = useFindBarOpen(paneId);
	const deviceToolbar = useDeviceToolbarState(paneId);
	const rootRef = useRef<HTMLDivElement | null>(null);
	const { designMode, popoverStyle } = useDesignModePane({
		paneId,
		store: designModeStore,
		isLoading: state.isLoading,
		rootRef,
		placeholderRef,
		overlayContainer,
	});

	// A pane switch or unmount must not leave a stale picker overlay armed in
	// the guest, nor an await resolving into a pane that no longer shows it.
	useEffect(() => {
		return () => {
			findBarStore.close(paneId);
			deviceToolbarStore.reset(paneId);
		};
	}, [paneId]);

	const isBlankPage = !state.currentUrl || state.currentUrl === "about:blank";

	const deviceToolbarSize = getDeviceToolbarSize(deviceToolbar);

	// Offer importing from another browser — as a banner above the page, not
	// just on the empty new-tab state — but only when one is actually
	// detected, so the CTA is never a dead end. Dismissal is persisted and
	// app-wide (see the store): local state here would reset on every remount
	// and bleed between panes through the unkeyed pane-component reuse.
	const importSource = useBrowserImportSource(browserImportSources);
	const [isImportOpen, setIsImportOpen] = useState(false);
	const isBannerDismissed = useBrowserImportBannerDismissalsStore((s) =>
		s.isDismissed(BROWSER_IMPORT_BANNER_ID),
	);
	const dismissBanner = useBrowserImportBannerDismissalsStore((s) => s.dismiss);

	return (
		// min-w-0: without it the banner row's intrinsic width becomes the pane
		// root's flex min-content, overflowing the pane slot — and the webview
		// follows the placeholder rect, painting over the neighbor pane.
		<div ref={rootRef} className="relative flex h-full min-w-0 flex-1 flex-col">
			{designMode.phase !== "idle" && (
				<DesignModeBanner
					phase={designMode.phase}
					onExit={() => designModeStore.exit(paneId)}
				/>
			)}
			{importSource && !isBannerDismissed && (
				<ChromeImportBanner
					browserKey={importSource.browserKey}
					browserName={importSource.browserName}
					onImport={() => setIsImportOpen(true)}
					onDismiss={() => dismissBanner(BROWSER_IMPORT_BANNER_ID)}
				/>
			)}
			{deviceToolbar.isOpen && (
				<DeviceToolbar
					state={deviceToolbar}
					onSetDevice={(deviceId) =>
						deviceToolbarStore.setDevice(paneId, deviceId)
					}
					onToggleRotate={() => deviceToolbarStore.toggleRotate(paneId)}
					onClose={() => deviceToolbarStore.close(paneId)}
				/>
			)}
			<BrowserViewportView
				deviceToolbar={deviceToolbar}
				deviceToolbarSize={deviceToolbarSize}
				placeholderRef={placeholderRef}
			/>
			{/* Everything that must paint over the page goes through the registry's
			    overlay layer: the webview is hoisted out of the pane tree, so no
			    z-index in here can reach above it. */}
			{overlayContainer &&
				createPortal(
					<>
						{isFindBarOpen && (
							<BrowserFindBar
								paneId={paneId}
								onClose={() => findBarStore.close(paneId)}
							/>
						)}
						{designMode.phase === "confirming" &&
							designMode.payload &&
							workspaceId && (
								<>
									{/* Click-catcher: the guest overlay froze pointer events on
									    selection, so without this a stray page click would
									    navigate out from under the open composer. */}
									<button
										type="button"
										aria-label={t({
											message: "Discard captured element",
										})}
										onClick={() => designModeStore.rearm(paneId)}
										className="pointer-events-auto absolute inset-0 z-10 cursor-default"
									/>
									<DesignModePopover
										workspaceId={workspaceId}
										paneId={paneId}
										payload={designMode.payload}
										style={popoverStyle}
										onDismiss={() => designModeStore.rearm(paneId)}
										onSent={() => designModeStore.exit(paneId)}
										onCreateNewAgentSession={onCreateNewAgentSession}
										onFocusAgentTerminal={onFocusAgentTerminal}
									/>
								</>
							)}
						{state.error && !state.isLoading && (
							<BrowserErrorOverlay error={state.error} onRetry={reload} />
						)}
						{isBlankPage && !state.isLoading && !state.error && (
							<div className="pointer-events-auto absolute inset-0 z-10 flex items-center justify-center bg-background">
								<div className="flex w-full max-w-sm flex-col items-center gap-5 px-6">
									<div className="flex size-14 items-center justify-center rounded-2xl bg-muted/50">
										<GlobeIcon className="size-7 text-muted-foreground" />
									</div>
									<div className="text-center">
										<p className="text-base font-medium text-foreground">
											<Trans>Start browsing</Trans>
										</p>
										<p className="mt-1.5 text-sm text-muted-foreground">
											<Trans>Enter a URL into the search bar above.</Trans>
										</p>
									</div>
								</div>
							</div>
						)}
					</>,
					overlayContainer,
				)}
			<ImportHistoryDialog open={isImportOpen} onOpenChange={setIsImportOpen} />
		</div>
	);
}

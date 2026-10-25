import { MENU_CLOSE_ANIMATION_MS } from "renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/hooks/usePaneRegistry/components/BrowserPane/components/BrowserOverflowMenu/utils/openAfterClose/openAfterClose";
import { BrowserOverflowMenuView } from "renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/hooks/usePaneRegistry/components/BrowserPane/components/BrowserOverflowMenu/components/BrowserOverflowMenuView";
import { useLingui } from "@lingui/react/macro";
import { Search } from "lucide-react";
import {
	useCallback,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import { createPortal } from "react-dom";
import { BrowserErrorOverlay } from "renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/hooks/usePaneRegistry/components/BrowserPane/components/BrowserErrorOverlay";
import { BrowserFindBarView } from "renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/hooks/usePaneRegistry/components/BrowserPane/components/BrowserFindBar/components/BrowserFindBarView";
import { BrowserToolbarView } from "renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/hooks/usePaneRegistry/components/BrowserPane/components/BrowserToolbar/components/BrowserToolbarView";
import { useBrowserStateCore } from "renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/hooks/usePaneRegistry/components/BrowserPane/hooks/useBrowserState/useBrowserStateCore";
import type {
	DirectDescriptor,
	DirectWorkstationApi,
} from "shared/direct-workstation";
import type { WorkspacePaneV2 } from "shared/workspace-view-v2";
import type { WorkspaceViewActions } from "../../../../hooks/useWorkspaceViews/useWorkspaceViews";
import { workstationBrowsers } from "../../../../providers/WorkstationBrowsers/workstation-browsers";

export function WorkspaceBrowserPane({
	api,
	connection,
	workspaceId,
	pane,
	actions,
	onFocus,
	onBrowserSettings,
	onOpenExternal,
}: {
	api: DirectWorkstationApi;
	connection: DirectDescriptor;
	workspaceId: string;
	pane: Extract<WorkspacePaneV2, { kind: "browser" }>;
	actions: WorkspaceViewActions;
	onFocus(): void;
	onBrowserSettings?(): void;
	onOpenExternal?(url: string): void;
}) {
	const { t } = useLingui();
	const runtime = workstationBrowsers(api);
	const placeholder = useRef<HTMLDivElement | null>(null);
	const [overlay, setOverlay] = useState<HTMLElement | null>(null);
	const [isMenuOpen, setIsMenuOpen] = useState(false);
	const settingsTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

	const [find, setFind] = useState(false);
	const [navigationError, setNavigationError] = useState<string | null>(null);
	const id = runtime.ensure(connection, workspaceId, pane, {
		onPersist: (state) => {
			const registration = runtime.registration(id);
			if (registration)
				actions.persistBrowserPage({
					pane: registration,
					resourceId: pane.resourceId,
					state,
				});
		},
		onClose: () => {
			void actions.closeBrowserPane(
				connection.connectionId,
				workspaceId,
				pane.paneId,
				pane.resourceId,
			);
		},
		onFocus,
		onNewWindow: (url) => {
			void actions.newBrowser(workspaceId, url, "split", connection);
		},
		onFind: () => setFind(true),
		onError: (error) =>
			setNavigationError(
				error instanceof Error ? error.message : String(error),
			),
	});
	const state = useBrowserStateCore(id, runtime.state);
	useEffect(
		() => () => {
			if (settingsTimer.current !== null) clearTimeout(settingsTimer.current);
			settingsTimer.current = null;
		},
		[id],
	);
	const openBrowserSettings = () => {
		const registration = runtime.registration(id);
		if (!registration) return;
		if (settingsTimer.current !== null) clearTimeout(settingsTimer.current);
		settingsTimer.current = setTimeout(() => {
			settingsTimer.current = null;
			if (
				runtime.registration(id)?.registrationId === registration.registrationId
			)
				onBrowserSettings?.();
		}, MENU_CLOSE_ANIMATION_MS);
	};

	const [displayIcon, setDisplayIcon] = useState<string | null>(null);
	useEffect(() => {
		let active = true;
		setDisplayIcon(null);
		const url = state.faviconUrl;
		if (!url) return;
		if (
			url.length <= 16384 &&
			/^data:image\/(?:png|jpeg|gif|webp|avif|svg\+xml|x-icon|vnd\.microsoft\.icon)[;,]/i.test(
				url,
			)
		) {
			setDisplayIcon(url);
			return;
		}
		const pane = runtime.registration(id);
		if (!pane || !api.browser?.getIcon) return;
		void api.browser.getIcon({ pane, url }).then(
			(result) => {
				if (
					active &&
					runtime.registration(id)?.registrationId === pane.registrationId
				)
					setDisplayIcon(result?.dataUrl ?? null);
			},
			() => {},
		);
		return () => {
			active = false;
		};
	}, [api, id, runtime, state.faviconUrl]);
	const loadHistory = useCallback(
		async () =>
			(await api.browser!.history!.getAll()).map((row) => ({
				...row,
				faviconUrl:
					row.faviconUrl && row.faviconUrl === pane.browser.faviconUrl
						? displayIcon
						: null,
			})),
		[api, displayIcon, pane.browser.faviconUrl],
	);
	useLayoutEffect(() => {
		if (!placeholder.current) return;
		runtime.attach(id, placeholder.current);
		setOverlay(runtime.core.getOverlayContainer(id));
		return () => {
			runtime.detach(id);
			setOverlay(null);
		};
	}, [runtime, id]);
	const navigate = (url: string) => {
		setNavigationError(null);
		void runtime
			.navigate(id, url)
			.catch((error) =>
				setNavigationError(
					error instanceof Error ? error.message : String(error),
				),
			);
	};
	const runTool = (
		action: (
			pane: NonNullable<ReturnType<typeof runtime.registration>>,
		) => Promise<unknown>,
	) => {
		const registration = runtime.registration(id);
		if (!registration) {
			setNavigationError(t({ message: "Session status unavailable." }));
			return;
		}
		setNavigationError(null);

		void (async () => {
			try {
				const result = await action(registration);
				if (
					runtime.registration(id)?.registrationId !==
					registration.registrationId
				)
					return;
				if (
					result &&
					typeof result === "object" &&
					"status" in result &&
					result.status === "stale"
				)
					setNavigationError(t({ message: "Session status unavailable." }));
			} catch (error) {
				if (
					runtime.registration(id)?.registrationId ===
					registration.registrationId
				)
					setNavigationError(
						error instanceof Error ? error.message : String(error),
					);
			}
		})();
	};

	return (
		<div
			className="flex h-full min-h-0 flex-col bg-background"
			data-workstation-browser-pane={pane.paneId}
			onKeyDown={(event) => {
				if (
					(event.ctrlKey || event.metaKey) &&
					event.key.toLowerCase() === "f"
				) {
					event.preventDefault();
					setFind(true);
				}
			}}
		>
			<div className="flex shrink-0 items-center border-b border-border">
				<div className="min-w-0 flex-1" data-workstation-browser-toolbar>
					<BrowserToolbarView
						registry={runtime.core}
						loadHistory={loadHistory}
						paneId={id}
						currentUrl={state.currentUrl}
						faviconUrl={displayIcon}
						isLoading={state.isLoading}
						canGoBack={state.canGoBack}
						canGoForward={state.canGoForward}
						onGoBack={() => runtime.core.goBack(id)}
						onGoForward={() => runtime.core.goForward(id)}
						onReload={() => runtime.core.reload(id)}
						onNavigate={navigate}
					/>
				</div>
				<button
					type="button"
					className="ws-button small"
					aria-label={t({ message: "Find in page" })}
					onClick={() => setFind(true)}
				>
					<Search size={14} />
				</button>
				<BrowserOverflowMenuView
					paneId={id}
					isMenuOpen={isMenuOpen}
					setIsMenuOpen={setIsMenuOpen}
					hasPage={!!state.currentUrl && state.currentUrl !== "about:blank"}
					zoomFactor={state.zoomFactor}
					onOpenFindBar={() => setFind(true)}
					handlePrint={() => runtime.core.print(id)}
					handleZoomOut={() => runtime.core.stepZoom(id, "out")}
					handleZoomIn={() => runtime.core.stepZoom(id, "in")}
					handleZoomReset={() => runtime.core.stepZoom(id, "reset")}
					handleOpenDevTools={
						api.browser?.openDevTools
							? () => runTool((pane) => api.browser!.openDevTools!({ pane }))
							: undefined
					}
					handleHardReload={
						api.browser?.reload
							? () =>
									runTool((pane) => api.browser!.reload!({ pane, hard: true }))
							: undefined
					}
					handleCopyUrl={
						api.copyText
							? () => runTool(() => api.copyText!(state.currentUrl))
							: undefined
					}
					handleOpenExternal={
						onOpenExternal ? () => onOpenExternal(state.currentUrl) : undefined
					}
					handleOpenSettings={
						onBrowserSettings ? openBrowserSettings : undefined
					}
				/>
			</div>
			{navigationError && (
				<output role="alert" className="ws-error">
					{navigationError}
				</output>
			)}
			<div ref={placeholder} className="relative min-h-0 flex-1" />
			{overlay &&
				createPortal(
					<>
						{find && (
							<div className="pointer-events-auto absolute right-3 top-3">
								<BrowserFindBarView
									registry={runtime.core}
									paneId={id}
									onClose={() => setFind(false)}
								/>
							</div>
						)}
						{state.error && (
							<BrowserErrorOverlay
								error={{ ...state.error, url: state.currentUrl }}
								onRetry={() => navigate(state.currentUrl)}
							/>
						)}
					</>,
					overlay,
				)}
		</div>
	);
}

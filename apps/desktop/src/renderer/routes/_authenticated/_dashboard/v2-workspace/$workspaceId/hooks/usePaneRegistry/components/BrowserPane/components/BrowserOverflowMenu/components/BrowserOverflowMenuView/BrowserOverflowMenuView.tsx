import { Trans, useLingui } from "@lingui/react/macro";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@superset/ui/dropdown-menu";
import { CheckIcon, MinusIcon, PlusIcon, RotateCcwIcon } from "lucide-react";
import { useEffect, type ReactNode } from "react";
import { TbDots } from "react-icons/tb";
import { pointerPassthrough } from "renderer/lib/pointer-passthrough";
import { BROWSER_ZOOM } from "../../../../browserRuntimeRegistryCore";

export interface BrowserOverflowMenuViewProps {
	paneId: string;
	isMenuOpen: boolean;
	setIsMenuOpen(open: boolean): void;
	hasPage: boolean;
	zoomFactor: number;
	isDeviceToolbarOpen?: boolean;
	signedInSites?: ReactNode;
	onOpenFindBar?(): void;
	handlePrint?(): void;
	handleOpenDevTools?(): void;
	onToggleDeviceToolbar?(): void;
	handleScreenshot?(): void;
	handleHardReload?(): void;
	handleCopyUrl?(): void;
	handleOpenExternal?(): void;
	handleOpenSettings?(): void;
	handleZoomOut?(): void;
	handleZoomIn?(): void;
	handleZoomReset?(): void;
	onImport?(): void;
	onDownloads?(): void;
	onScreenshots?(): void;
	onHistory?(): void;
	onClearData?(): void;
}
export function BrowserOverflowMenuView({
	paneId,
	isMenuOpen,
	setIsMenuOpen,
	hasPage,
	zoomFactor,
	isDeviceToolbarOpen = false,
	signedInSites,
	onOpenFindBar,
	handlePrint,
	handleOpenDevTools,
	onToggleDeviceToolbar,
	handleScreenshot,
	handleHardReload,
	handleCopyUrl,
	handleOpenExternal,
	handleOpenSettings,
	handleZoomOut,
	handleZoomIn,
	handleZoomReset,
	onImport,
	onDownloads,
	onScreenshots,
	onHistory,
	onClearData,
}: BrowserOverflowMenuViewProps) {
	const { t } = useLingui();
	useEffect(() => {
		const source = `host-popover:${paneId}`;
		pointerPassthrough.set(source, isMenuOpen);
		return () => pointerPassthrough.set(source, false);
	}, [paneId, isMenuOpen]);
	return (
		<DropdownMenu open={isMenuOpen} onOpenChange={setIsMenuOpen}>
			<DropdownMenuTrigger asChild>
				<button
					type="button"
					aria-label={t({ message: "More options" })}
					className="rounded-md p-1 text-muted-foreground/70 transition-colors hover:bg-muted/50 hover:text-foreground"
				>
					<TbDots className="size-3.5" />
				</button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end" className="w-64">
				{onOpenFindBar && (
					<DropdownMenuItem onClick={onOpenFindBar} disabled={!hasPage}>
						<Trans>Find in page</Trans>
					</DropdownMenuItem>
				)}
				{handlePrint && (
					<DropdownMenuItem onClick={handlePrint} disabled={!hasPage}>
						<Trans>Print</Trans>
					</DropdownMenuItem>
				)}
				{handleOpenDevTools && (
					<DropdownMenuItem onClick={handleOpenDevTools} disabled={!hasPage}>
						<Trans>Open DevTools</Trans>
					</DropdownMenuItem>
				)}
				{handleZoomOut && handleZoomIn && handleZoomReset && (
					<DropdownMenuSeparator />
				)}
				{handleZoomOut && handleZoomIn && handleZoomReset && (
					<DropdownMenuItem
						disabled={!hasPage}
						onSelect={(e) => e.preventDefault()}
						onKeyDown={(e) => {
							if (e.key === "ArrowLeft") {
								e.preventDefault();
								handleZoomOut();
							} else if (e.key === "ArrowRight") {
								e.preventDefault();
								handleZoomIn();
							} else if (e.key === "Enter" || e.key === "0") {
								e.preventDefault();
								handleZoomReset();
							}
						}}
						className="justify-between gap-2"
					>
						<span>
							<Trans>Zoom</Trans>
						</span>
						<div className="flex items-center gap-1">
							<button
								type="button"
								tabIndex={-1}
								onClick={handleZoomOut}
								disabled={!hasPage || zoomFactor <= BROWSER_ZOOM.min}
								aria-label={t({
									message: "Zoom out",
								})}
								className="rounded p-1 text-muted-foreground/70 transition-colors hover:bg-muted/50 hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
							>
								<MinusIcon className="size-3.5" />
							</button>
							<span className="w-10 text-center text-xs tabular-nums text-muted-foreground">
								{Math.round(zoomFactor * 100)}%
							</span>
							<button
								type="button"
								tabIndex={-1}
								onClick={handleZoomIn}
								disabled={!hasPage || zoomFactor >= BROWSER_ZOOM.max}
								aria-label={t({
									message: "Zoom in",
								})}
								className="rounded p-1 text-muted-foreground/70 transition-colors hover:bg-muted/50 hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
							>
								<PlusIcon className="size-3.5" />
							</button>
							<button
								type="button"
								tabIndex={-1}
								onClick={handleZoomReset}
								disabled={!hasPage || zoomFactor === 1}
								aria-label={t({
									message: "Reset zoom",
								})}
								className="rounded p-1 text-muted-foreground/70 transition-colors hover:bg-muted/50 hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
							>
								<RotateCcwIcon className="size-3.5" />
							</button>
						</div>
					</DropdownMenuItem>
				)}
				{(onToggleDeviceToolbar || handleScreenshot) && (
					<DropdownMenuSeparator />
				)}
				{onToggleDeviceToolbar && (
					<DropdownMenuItem
						onClick={onToggleDeviceToolbar}
						disabled={!hasPage}
						className="justify-between"
					>
						<Trans>Show device toolbar</Trans>
						{isDeviceToolbarOpen && <CheckIcon className="size-3.5" />}
					</DropdownMenuItem>
				)}
				{handleScreenshot && (
					<DropdownMenuItem onClick={handleScreenshot} disabled={!hasPage}>
						<Trans>Take a screenshot</Trans>
					</DropdownMenuItem>
				)}
				{(onToggleDeviceToolbar || handleScreenshot) &&
					(handleHardReload || handleCopyUrl || handleOpenExternal) && (
						<DropdownMenuSeparator />
					)}
				{handleHardReload && (
					<DropdownMenuItem onClick={handleHardReload} disabled={!hasPage}>
						<Trans>Hard reload</Trans>
					</DropdownMenuItem>
				)}
				{handleCopyUrl && (
					<DropdownMenuItem onClick={handleCopyUrl} disabled={!hasPage}>
						<Trans>Copy URL</Trans>
					</DropdownMenuItem>
				)}
				{handleOpenExternal && (
					<DropdownMenuItem onClick={handleOpenExternal} disabled={!hasPage}>
						<Trans>Open in Browser</Trans>
					</DropdownMenuItem>
				)}
				{(onImport ||
					signedInSites ||
					onDownloads ||
					onScreenshots ||
					onHistory ||
					onClearData) && <DropdownMenuSeparator />}
				{onImport && (
					<DropdownMenuItem onSelect={onImport}>
						<Trans>Import cookies and passwords…</Trans>
					</DropdownMenuItem>
				)}
				{signedInSites}
				{onDownloads && (
					<DropdownMenuItem onSelect={onDownloads}>
						<Trans>Downloads</Trans>
					</DropdownMenuItem>
				)}
				{onScreenshots && (
					<DropdownMenuItem onSelect={onScreenshots}>
						<Trans>Screenshots</Trans>
					</DropdownMenuItem>
				)}
				{onHistory && (
					<DropdownMenuItem onSelect={onHistory}>
						<Trans>History</Trans>
					</DropdownMenuItem>
				)}
				{onClearData && (
					<DropdownMenuItem onSelect={onClearData}>
						<Trans>Clear browsing data</Trans>
					</DropdownMenuItem>
				)}
				{handleOpenSettings && <DropdownMenuSeparator />}
				{handleOpenSettings && (
					<DropdownMenuItem onClick={handleOpenSettings}>
						<Trans>Browser settings</Trans>
					</DropdownMenuItem>
				)}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

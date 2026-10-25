import { msg } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { i18n } from "@superset/i18n";
import type { SelectDownload } from "@superset/local-db/downloads";
import { Button } from "@superset/ui/button";
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
} from "@superset/ui/dialog";
import { ScrollArea } from "@superset/ui/scroll-area";
import { useEffect, useRef, useState } from "react";
import { TbFolderOpen, TbX } from "react-icons/tb";

export type DownloadRow = Pick<
	SelectDownload,
	"id" | "filename" | "receivedBytes" | "totalBytes" | "state"
>;

export interface DownloadsSource {
	subscribe(
		onData: (rows: DownloadRow[]) => void,
		onError: () => void,
	): () => void;
	cancel(id: string): Promise<{ cancelled: boolean }>;
	open(id: string): Promise<{ success: boolean }>;
	showInFolder(id: string): Promise<{ success: boolean }>;
	clear(): Promise<{ success: boolean }>;
}
interface DownloadsDialogProps {
	source: DownloadsSource;
	open: boolean;
	onOpenChange: (open: boolean) => void;
}

function formatBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	if (bytes < 1024 * 1024 * 1024)
		return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
	return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function stateLabel(row: DownloadRow): string {
	switch (row.state) {
		case "progressing": {
			const total = row.totalBytes;
			return total
				? i18n._({
						...msg({
							message: "{received} of {total}",
						}),
						values: {
							received: formatBytes(row.receivedBytes),
							total: formatBytes(total),
						},
					})
				: formatBytes(row.receivedBytes);
		}
		case "completed":
			return formatBytes(row.receivedBytes);
		case "cancelled":
			return i18n._(
				msg({
					message: "Cancelled",
				}),
			);
		case "interrupted":
			return i18n._(
				msg({
					message: "Failed",
				}),
			);
	}
}

export function DownloadsDialogView({
	source,
	open,
	onOpenChange,
}: DownloadsDialogProps) {
	const { t } = useLingui();
	const [rows, setRows] = useState<DownloadRow[]>([]);

	const [failed, setFailed] = useState(false);
	const revision = useRef(0);
	useEffect(() => {
		if (!open) return;
		let current = true;
		const currentRevision = ++revision.current;
		setFailed(false);
		const stop = source.subscribe(
			(rows) => {
				if (current && revision.current === currentRevision) {
					setRows(rows);
					setFailed(false);
				}
			},
			() => {
				if (current && revision.current === currentRevision) setFailed(true);
			},
		);
		return () => {
			current = false;
			revision.current++;
			stop();
		};
	}, [open, source]);
	const run = (
		operation: Promise<{ success?: boolean; cancelled?: boolean }>,
	) => {
		setFailed(false);
		const current = revision.current;
		void operation.then(
			(result) => {
				if (
					revision.current === current &&
					(result.success === false || result.cancelled === false)
				)
					setFailed(true);
			},
			() => {
				if (revision.current === current) setFailed(true);
			},
		);
	};
	const handleCancel = (id: string) => run(source.cancel(id));
	const handleOpen = (id: string) => run(source.open(id));
	const handleShowInFolder = (id: string) => run(source.showInFolder(id));
	const handleClear = () => run(source.clear());

	const hasFinished = rows.some((r) => r.state !== "progressing");

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="max-w-lg">
				<DialogHeader>
					<DialogTitle>
						<Trans>Downloads</Trans>
					</DialogTitle>
				</DialogHeader>
				{failed && (
					<output role="alert" className="text-sm text-destructive">
						<Trans>An error occurred</Trans>
					</output>
				)}
				<ScrollArea className="h-80 min-w-0 -mx-1 px-1">
					{rows.length === 0 ? (
						failed ? null : (
							<p className="py-8 text-center text-sm text-muted-foreground">
								<Trans>No downloads yet</Trans>
							</p>
						)
					) : (
						<div className="flex min-w-0 flex-col">
							{rows.map((row) => (
								<div
									key={row.id}
									className="flex w-full min-w-0 items-center gap-2.5 rounded-md px-2 py-2 text-sm"
								>
									<button
										type="button"
										onClick={() =>
											row.state === "completed" && handleOpen(row.id)
										}
										disabled={row.state !== "completed"}
										className="min-w-0 flex-1 text-left disabled:cursor-default"
									>
										<div className="truncate text-foreground">
											{row.filename}
										</div>
										<div className="truncate text-xs text-muted-foreground">
											{stateLabel(row)}
										</div>
									</button>
									{row.state === "progressing" ? (
										<button
											type="button"
											onClick={() => handleCancel(row.id)}
											aria-label={t({
												message: "Cancel download",
											})}
											className="shrink-0 rounded p-1 text-muted-foreground/60 transition-colors hover:text-foreground"
										>
											<TbX className="size-4" />
										</button>
									) : (
										<button
											type="button"
											onClick={() => handleShowInFolder(row.id)}
											aria-label={t({
												message: "Show in folder",
											})}
											className="shrink-0 rounded p-1 text-muted-foreground/60 transition-colors hover:text-foreground"
										>
											<TbFolderOpen className="size-4" />
										</button>
									)}
								</div>
							))}
						</div>
					)}
				</ScrollArea>
				<div className="flex justify-end border-t pt-3">
					<Button
						variant="ghost"
						size="sm"
						onClick={handleClear}
						disabled={!hasFinished}
					>
						<Trans>Clear list</Trans>
					</Button>
				</div>
			</DialogContent>
		</Dialog>
	);
}

import { Trans, useLingui } from "@lingui/react/macro";
import { useFormat } from "@superset/i18n/react";
import type { SelectScreenshot } from "@superset/local-db/screenshots";
import { Button } from "@superset/ui/button";
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
} from "@superset/ui/dialog";
import { ScrollArea } from "@superset/ui/scroll-area";
import { toast } from "@superset/ui/sonner";
import { useEffect, useRef, useState } from "react";
import { LuCheck } from "react-icons/lu";
import { TbCopy, TbFolderOpen } from "react-icons/tb";

export type ScreenshotRow = Pick<
	SelectScreenshot,
	| "id"
	| "filename"
	| "savePath"
	| "width"
	| "height"
	| "thumbnail"
	| "capturedAt"
>;
export interface ScreenshotsSource {
	subscribe(
		onData: (rows: ScreenshotRow[]) => void,
		onError: () => void,
	): () => void;
	open(id: string): Promise<{ success: boolean }>;
	showInFolder(id: string): Promise<{ success: boolean }>;
	clear(): Promise<{ success: boolean }>;
	copyPath(savePath: string): Promise<void>;
}
interface ScreenshotsDialogProps {
	source: ScreenshotsSource;
	open: boolean;
	onOpenChange: (open: boolean) => void;
}

export function ScreenshotsDialogView({
	source,
	open,
	onOpenChange,
}: ScreenshotsDialogProps) {
	const { formatDateTime } = useFormat();

	const { t } = useLingui();
	const [rows, setRows] = useState<ScreenshotRow[]>([]);

	const [failed, setFailed] = useState(false),
		revision = useRef(0);
	useEffect(() => {
		if (!open) return;
		let active = true;
		const current = ++revision.current;
		setFailed(false);
		const stop = source.subscribe(
			(rows) => {
				if (active && revision.current === current) {
					setRows(rows);
					setFailed(false);
				}
			},
			() => {
				if (active && revision.current === current) setFailed(true);
			},
		);
		return () => {
			active = false;
			revision.current++;
			stop();
		};
	}, [open, source]);
	const run = (operation: Promise<{ success: boolean }>) => {
		setFailed(false);
		const current = revision.current;
		void operation.then(
			(result) => {
				if (current === revision.current && !result.success) setFailed(true);
			},
			() => {
				if (current === revision.current) setFailed(true);
			},
		);
	};
	const handleOpen = (id: string) => run(source.open(id));
	const handleShowInFolder = (id: string) => run(source.showInFolder(id));

	const handleCopyPath = (savePath: string) => {
		const current = revision.current;
		source
			.copyPath(savePath)
			.then(() => {
				if (current !== revision.current) return;
				toast.success(
					t({
						message: "Path copied",
					}),
					{
						description: savePath,
						icon: (
							<span className="flex size-4 items-center justify-center rounded-full bg-emerald-500">
								<LuCheck className="size-2.5 text-white" strokeWidth={3} />
							</span>
						),
					},
				);
			})
			.catch(() => {
				if (current !== revision.current) return;
				toast.error(
					t({
						message: "Couldn't copy path",
					}),
				);
			});
	};

	const handleClear = () => {
		run(source.clear());
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="max-w-lg">
				<DialogHeader>
					<DialogTitle>
						<Trans>Screenshots</Trans>
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
								<Trans>No screenshots yet</Trans>
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
										onClick={() => handleOpen(row.id)}
										className="min-w-0 flex-1 text-left"
									>
										<div className="flex items-center gap-2.5">
											<img
												src={row.thumbnail}
												alt=""
												className="h-10 w-14 shrink-0 rounded border border-border object-cover"
											/>
											<div className="min-w-0">
												<div className="truncate text-foreground">
													{row.filename}
												</div>
												<div className="truncate text-xs text-muted-foreground">
													{formatDateTime(new Date(row.capturedAt), undefined)}{" "}
													· {row.width}×{row.height}
												</div>
											</div>
										</div>
									</button>
									<button
										type="button"
										onClick={() => handleCopyPath(row.savePath)}
										aria-label={t({
											message: "Copy path",
										})}
										title={t({
											message: "Copy path",
										})}
										className="shrink-0 rounded p-1 text-muted-foreground/60 transition-colors hover:text-foreground"
									>
										<TbCopy className="size-4" />
									</button>
									<button
										type="button"
										onClick={() => handleShowInFolder(row.id)}
										aria-label={t({
											message: "Show in folder",
										})}
										title={t({
											message: "Show in folder",
										})}
										className="shrink-0 rounded p-1 text-muted-foreground/60 transition-colors hover:text-foreground"
									>
										<TbFolderOpen className="size-4" />
									</button>
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
						disabled={rows.length === 0}
					>
						<Trans>Clear list</Trans>
					</Button>
				</div>
			</DialogContent>
		</Dialog>
	);
}

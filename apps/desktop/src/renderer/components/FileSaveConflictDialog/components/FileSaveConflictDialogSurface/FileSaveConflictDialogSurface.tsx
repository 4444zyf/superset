import { Trans } from "@lingui/react/macro";
import { Button } from "@superset/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@superset/ui/dialog";
import { type ReactNode, useRef } from "react";
import type { FileContents } from "shared/changes-types";
import { detectLanguage } from "shared/detect-language";

export interface FileSaveConflictDialogSurfaceProps {
	open: boolean;
	filePath: string;
	localContent: string;
	diskContent: string | null;
	isSaving?: boolean;
	onOpenChange: (open: boolean) => void;
	onKeepEditing: () => void;
	onReloadFromDisk: () => void;
	onOverwrite: () => void;
	overwriteDisabled?: boolean;
	renderDiff(contents: FileContents, filePath: string): ReactNode;
}

export function FileSaveConflictDialogSurface({
	open,
	filePath,
	localContent,
	diskContent,
	isSaving = false,
	onOpenChange,
	onKeepEditing,
	onReloadFromDisk,
	onOverwrite,
	overwriteDisabled = false,
	renderDiff,
}: FileSaveConflictDialogSurfaceProps) {
	const keepEditingRef = useRef<HTMLButtonElement>(null);

	return (
		<Dialog
			open={open}
			onOpenChange={isSaving ? undefined : onOpenChange}
			modal
		>
			<DialogContent
				className="flex max-h-[85vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-[min(1100px,calc(100vw-2rem))]"
				onOpenAutoFocus={(event) => {
					event.preventDefault();
					keepEditingRef.current?.focus();
				}}
			>
				<DialogHeader className="border-b px-6 py-4">
					<DialogTitle>
						<Trans>File changed on disk</Trans>
					</DialogTitle>
					<DialogDescription>
						{diskContent === null ? (
							<Trans>Unable to read file</Trans>
						) : (
							<Trans>
								The file changed on disk. Review it before saving again.
							</Trans>
						)}
					</DialogDescription>
					<div className="break-all text-xs text-muted-foreground">
						{filePath}
					</div>
				</DialogHeader>
				{diskContent !== null && (
					<>
						<div className="grid grid-cols-2 border-b px-6 py-2 text-xs font-medium">
							<span>
								<Trans>Disk version</Trans>
							</span>
							<span>
								<Trans>Your changes</Trans>
							</span>
						</div>
						<div className="min-h-0 flex-1 overflow-auto">
							{renderDiff(
								{
									original: diskContent,
									modified: localContent,
									language: detectLanguage(filePath),
								},
								filePath,
							)}
						</div>
					</>
				)}
				<p className="border-t px-6 py-3 text-xs text-muted-foreground">
					<Trans>
						Reloading discards your edits. Overwriting replaces the file on
						disk.
					</Trans>
				</p>
				{overwriteDisabled && (
					<p className="px-6 pb-3 text-xs text-muted-foreground">
						<Trans>This backend does not support the required capability</Trans>
					</p>
				)}
				<DialogFooter className="px-6 pb-4">
					<Button
						ref={keepEditingRef}
						variant="outline"
						onClick={onKeepEditing}
						disabled={isSaving}
					>
						<Trans>Keep editing</Trans>
					</Button>
					<Button
						variant="outline"
						onClick={onReloadFromDisk}
						disabled={isSaving || diskContent === null}
					>
						<Trans>Reload from disk</Trans>
					</Button>
					<Button
						variant="destructive"
						onClick={onOverwrite}
						disabled={isSaving || overwriteDisabled}
					>
						<Trans>Overwrite file</Trans>
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

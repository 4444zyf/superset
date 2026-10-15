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
import { Input } from "@superset/ui/input";
import { Label } from "@superset/ui/label";
import { type ReactNode, useId } from "react";

export function RenameBranchDialogSurface({
	value,
	onValueChange,
	currentBranchName,
	open,
	onOpenChange,
	isSubmitting,
	disabled = false,
	onSubmit,
	footer,
}: {
	value: string;
	onValueChange(value: string): void;
	currentBranchName: string;
	open: boolean;
	onOpenChange(open: boolean): void;
	isSubmitting: boolean;
	disabled?: boolean;
	onSubmit(): void;
	footer?: ReactNode;
}) {
	const inputId = useId();
	const isInvalid = !value.trim() || value.trim() === currentBranchName;
	return (
		<Dialog open={open} onOpenChange={onOpenChange} modal>
			<DialogContent className="max-w-[420px]">
				<DialogHeader>
					<DialogTitle>
						<Trans>Rename branch</Trans>
					</DialogTitle>
					<DialogDescription>
						<Trans>
							Rename the local branch. Branches that have been pushed to remote
							cannot be renamed.
						</Trans>
					</DialogDescription>
				</DialogHeader>
				<form
					onSubmit={(e) => {
						e.preventDefault();
						onSubmit();
					}}
					className="space-y-4"
				>
					<div className="space-y-1.5">
						<Label htmlFor={inputId} className="text-xs">
							<Trans>Branch name</Trans>
						</Label>
						<Input
							id={inputId}
							value={value}
							onChange={(e) => onValueChange(e.target.value)}
							onKeyDown={(e) => {
								if (e.key === "Enter") {
									e.preventDefault();
									e.stopPropagation();
									if (!e.nativeEvent.isComposing && e.keyCode !== 229)
										onSubmit();
								}
							}}
							autoFocus
							disabled={isSubmitting}
							spellCheck={false}
							autoComplete="off"
							className="font-mono"
						/>
					</div>
					<DialogFooter>
						{footer}
						<Button
							type="button"
							variant="ghost"
							onClick={() => onOpenChange(false)}
							disabled={isSubmitting}
						>
							<Trans>Cancel</Trans>
						</Button>
						<Button
							type="submit"
							disabled={isInvalid || disabled || isSubmitting}
						>
							<Trans>Rename</Trans>
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}

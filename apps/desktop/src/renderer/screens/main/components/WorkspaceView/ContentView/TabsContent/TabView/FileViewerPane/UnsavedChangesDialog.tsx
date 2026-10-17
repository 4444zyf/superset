import { Trans } from "@lingui/react/macro";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
	EnterEnabledAlertDialogContent,
} from "@superset/ui/alert-dialog";
import { Button } from "@superset/ui/button";
import type { ReactNode } from "react";
import { LuLoader } from "react-icons/lu";

interface UnsavedChangesDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onSave?: () => void;
	onDiscard: () => void;
	isSaving?: boolean;
	title?: string;
	description?: string;
	discardLabel?: string;
	saveLabel?: string;
	details?: ReactNode;
	closeOnDiscard?: boolean;
}

export function UnsavedChangesDialog({
	open,
	onOpenChange,
	onSave,
	onDiscard,
	isSaving = false,
	title = "Unsaved Changes",
	description = "You have unsaved changes. What would you like to do?",
	discardLabel = "Discard & Continue",
	saveLabel = "Save & Continue",
	details,
	closeOnDiscard = true,
}: UnsavedChangesDialogProps) {
	const handleSaveAndSwitch = () => {
		onSave?.();
	};

	const handleDiscardAndSwitch = () => {
		onDiscard();
	};

	return (
		<AlertDialog open={open} onOpenChange={isSaving ? undefined : onOpenChange}>
			<EnterEnabledAlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle>{title}</AlertDialogTitle>
					<AlertDialogDescription>{description}</AlertDialogDescription>
				</AlertDialogHeader>
				{details}
				<AlertDialogFooter>
					<AlertDialogCancel disabled={isSaving}>
						<Trans>Cancel</Trans>
					</AlertDialogCancel>
					<AlertDialogAction
						variant="outline"
						onClick={(event) => {
							if (!closeOnDiscard) event.preventDefault();
							handleDiscardAndSwitch();
						}}
						disabled={isSaving}
						className="border-destructive/50 text-destructive hover:bg-destructive/10"
					>
						{discardLabel}
					</AlertDialogAction>
					{onSave && (
						<Button onClick={handleSaveAndSwitch} disabled={isSaving}>
							{isSaving ? (
								<>
									<LuLoader className="mr-2 h-4 w-4 animate-spin" />
									<Trans>Saving...</Trans>
								</>
							) : (
								saveLabel
							)}
						</Button>
					)}
				</AlertDialogFooter>
			</EnterEnabledAlertDialogContent>
		</AlertDialog>
	);
}

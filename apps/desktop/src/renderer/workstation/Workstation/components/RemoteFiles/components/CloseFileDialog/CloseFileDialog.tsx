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
import type { SharedFileDocument } from "renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/state/fileDocumentStore/types";
export function CloseFileDialog({
	documents,
	onCancel,
	onDiscard,
}: {
	documents: SharedFileDocument[];
	onCancel(): void;
	onDiscard(): void;
}) {
	return (
		<Dialog
			open={documents.length > 0}
			onOpenChange={(open) => {
				if (!open) onCancel();
			}}
		>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>
						<Trans>Unsaved changes</Trans>
					</DialogTitle>
					<DialogDescription className="max-h-64 overflow-auto whitespace-pre-line">
						{documents.map((document) => document.absolutePath).join("\n")}
					</DialogDescription>
				</DialogHeader>
				<DialogFooter>
					<Button variant="outline" onClick={onCancel}>
						<Trans>Cancel</Trans>
					</Button>
					<Button
						variant="destructive"
						onClick={onDiscard}
						disabled={documents.some((document) => document.pendingSave)}
					>
						<Trans>Discard changes</Trans>
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

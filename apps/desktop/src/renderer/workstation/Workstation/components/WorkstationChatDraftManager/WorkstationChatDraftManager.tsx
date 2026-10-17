import { Trans, useLingui } from "@lingui/react/macro";
import { errorMessage } from "@superset/i18n/errors";
import { Button } from "@superset/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@superset/ui/dialog";
import { Textarea } from "@superset/ui/textarea";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { CopyButton } from "renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/hooks/usePaneRegistry/components/ChatSession/components/CopyButton";
import { AttachmentTile } from "renderer/routes/_authenticated/components/AttachmentTile";
import { UnsavedChangesDialog } from "renderer/screens/main/components/WorkspaceView/ContentView/TabsContent/TabView/FileViewerPane/UnsavedChangesDialog";
import {
	type ChatDraftEntry,
	type ChatDraftTarget,
	chatDraftKey,
} from "../../../../../shared/workstation-chat-drafts";
import type { WorkstationChatDraftStore } from "../../providers/WorkstationChatDrafts/workstation-chat-drafts";
import type { DirectProfile } from "../../types";

export function WorkstationChatDraftManager({
	store,
	profiles,
	target,
	onClose,
}: {
	store: WorkstationChatDraftStore;
	profiles: DirectProfile[];
	target?: ChatDraftTarget;
	onClose(): void;
}) {
	const { t } = useLingui();
	useSyncExternalStore(store.subscribe, store.getVersion, store.getVersion);
	const entries = store.list(target);
	const [confirmation, setConfirmation] = useState<ChatDraftEntry | null>(null);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const mounted = useRef(false);
	const pending = useRef(false);
	useEffect(() => {
		mounted.current = true;
		void store.start().catch(() => {});
		return () => {
			mounted.current = false;
		};
	}, [store]);
	const discard = async () => {
		if (!confirmation || pending.current || !store.isReady()) return;
		pending.current = true;
		setBusy(true);
		setError(null);
		try {
			const discarded = await store.discard(
				confirmation.identity,
				confirmation.value,
			);
			if (mounted.current) {
				if (discarded) setConfirmation(null);
				else
					setError(
						t({ message: "This draft changed. Review it before discarding." }),
					);
			}
		} catch (error) {
			if (mounted.current) setError(errorMessage(error));
		} finally {
			pending.current = false;
			if (mounted.current) setBusy(false);
		}
	};
	return (
		<>
			<Dialog
				modal
				open
				onOpenChange={(open) => {
					if (!open && !pending.current) onClose();
				}}
			>
				<DialogContent
					data-chat-drafts
					className="min-w-0 grid-cols-[minmax(0,1fr)] max-h-[85vh] overflow-y-auto sm:max-w-3xl"
				>
					<DialogHeader>
						<DialogTitle>
							<Trans>Chat drafts</Trans>
						</DialogTitle>
						<DialogDescription>
							<Trans>
								Review unsent drafts stored on this device, including
								unavailable sessions.
							</Trans>
						</DialogDescription>
					</DialogHeader>
					{(error || store.error) && (
						<p role="alert" className="break-all text-sm text-destructive">
							{error || store.error}
						</p>
					)}
					{!store.isReady() && (
						<>
							<p>
								<Trans>Loading...</Trans>
							</p>
							{store.error && (
								<Button
									onClick={() => {
										void store.start().catch(() => {});
									}}
								>
									<Trans>Retry</Trans>
								</Button>
							)}
						</>
					)}
					{store.isReady() && !entries.length && (
						<p className="text-sm text-muted-foreground">
							<Trans>No chat drafts.</Trans>
						</p>
					)}
					{entries.map((entry) => (
						<article
							key={chatDraftKey(entry.identity)}
							data-chat-draft={chatDraftKey(entry.identity)}
							className="min-w-0 space-y-3 rounded-lg border border-border p-4"
						>
							<dl className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs">
								<dt>
									<Trans>Connection</Trans>
								</dt>
								<dd className="break-all">
									{profiles.find((p) => p.id === entry.identity.connectionId)
										?.name ?? entry.identity.connectionId}
								</dd>
								<dt>
									<Trans>Workspace</Trans>
								</dt>
								<dd className="break-all">{entry.identity.workspaceId}</dd>
								<dt>
									<Trans>Session</Trans>
								</dt>
								<dd className="break-all">{entry.identity.sessionId}</dd>
							</dl>
							<details className="text-xs text-muted-foreground break-all">
								<summary>
									<Trans>Connection details</Trans>
								</summary>
								<p>{entry.identity.backendId}</p>
								<p>{entry.identity.namespaceId}</p>
							</details>
							<Textarea
								aria-label={t({ message: "Message" })}
								readOnly
								value={entry.value.text}
								rows={4}
								className="max-h-48 resize-none"
							/>
							<div className="flex min-w-0 flex-wrap gap-2">
								{entry.value.attachments.map((a) => (
									<AttachmentTile
										key={a.attachmentId}
										filename={a.originalFilename || a.attachmentId}
										imageUrl={null}
										onOpen={null}
									/>
								))}
							</div>
							<div className="flex items-center justify-end gap-2">
								{entry.value.text && (
									<CopyButton
										text={entry.value.text}
										label={t({ message: "Copy" })}
									/>
								)}
								<Button
									variant="ghost"
									size="sm"
									disabled={busy || !store.isReady()}
									onClick={() => {
										setError(null);
										setConfirmation(entry);
									}}
								>
									<Trans>Discard changes</Trans>
								</Button>
							</div>
						</article>
					))}
				</DialogContent>
			</Dialog>
			<UnsavedChangesDialog
				open={confirmation !== null}
				onOpenChange={(open) => {
					if (!open && !pending.current) {
						setConfirmation(null);
						setError(null);
					}
				}}
				onDiscard={() => void discard()}
				closeOnDiscard={false}
				isSaving={busy}
				title={t({ message: "Unsaved changes" })}
				description={t({
					message: "Your changes will be lost if you don't save them.",
				})}
				discardLabel={t({ message: "Discard changes" })}
				details={
					error || store.error ? (
						<p role="alert" className="break-all text-sm text-destructive">
							{error || store.error}
						</p>
					) : undefined
				}
			/>
		</>
	);
}

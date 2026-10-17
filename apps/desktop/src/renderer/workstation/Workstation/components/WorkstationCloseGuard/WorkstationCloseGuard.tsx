import { useLingui } from "@lingui/react/macro";
import { errorMessage } from "@superset/i18n/errors";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { UnsavedChangesDialog } from "renderer/screens/main/components/WorkspaceView/ContentView/TabsContent/TabView/FileViewerPane/UnsavedChangesDialog";
import type { DirectWorkstationApi } from "../../../../../shared/direct-workstation";
import type { WorkstationChatDraftStore } from "../../providers/WorkstationChatDrafts/workstation-chat-drafts";
import { WorkstationEditorGuards } from "../../providers/WorkstationEditorGuards/workstation-editor-guards";
import type { WorkstationFileDocuments } from "../../providers/WorkstationFileDocuments";

const EMPTY_EDITORS = new WorkstationEditorGuards();
export function WorkstationCloseGuard({
	api,
	documents,
	chatDrafts,
	editors = EMPTY_EDITORS,
}: {
	api: DirectWorkstationApi;
	documents: WorkstationFileDocuments;
	chatDrafts?: Pick<WorkstationChatDraftStore, "flush">;
	editors?: Pick<
		WorkstationEditorGuards,
		"getUnsaved" | "getVersion" | "subscribe"
	>;
}) {
	const { t } = useLingui();
	useSyncExternalStore(
		documents.subscribe,
		documents.getVersion,
		documents.getVersion,
	);
	useSyncExternalStore(
		editors.subscribe,
		editors.getVersion,
		editors.getVersion,
	);
	const [open, setOpen] = useState(false);
	const [saving, setSaving] = useState(false);
	const [saveError, setSaveError] = useState("");
	const pending = useRef<{
		resolve(value: boolean): void;
		promise: Promise<boolean>;
	} | null>(null);
	const finish = (allow: boolean) => {
		const request = pending.current;
		if (!request) return;
		pending.current = null;
		setOpen(false);
		request.resolve(allow);
	};
	useEffect(() => {
		let current = true;
		const stop = api.onWindowCloseRequest?.(async () => {
			let draftError = "";
			try {
				await chatDrafts?.flush();
			} catch (error) {
				draftError = errorMessage(error);
			}
			if (!current) return false;
			if (pending.current) return pending.current.promise;
			if (
				!draftError &&
				documents.getUnsavedDocuments().length === 0 &&
				editors.getUnsaved().length === 0
			)
				return Promise.resolve(true);
			let resolve!: (value: boolean) => void;
			const promise = new Promise<boolean>((done) => {
				resolve = done;
			});
			pending.current = { resolve, promise };
			setSaveError(draftError);
			setSaving(false);
			setOpen(true);
			return promise;
		});
		return () => {
			current = false;
			const request = pending.current;
			pending.current = null;
			request?.resolve(false);
			stop?.();
		};
	}, [api, documents, chatDrafts, editors]);
	const unsaved = documents.getUnsavedDocuments();
	const editorDrafts = editors.getUnsaved();
	const busy =
		saving ||
		unsaved.some((document) => document.pendingSave) ||
		editorDrafts.some((guard) => guard.isPending());
	const save = async () => {
		const request = pending.current;
		if (!request || busy) return;
		setSaving(true);
		setSaveError("");
		try {
			await chatDrafts?.flush();
			if (pending.current !== request) return;
			for (const document of documents.getUnsavedDocuments()) {
				if (document.pendingSave) return;
				if (!document.dirty) continue;
				const result = await document.save();
				if (pending.current !== request) return;
				if (result.status !== "saved") {
					setSaveError(
						result.status === "error"
							? errorMessage(result.error)
							: result.status === "not-found"
								? t({ message: "File not found" })
								: t({ message: "File changed on disk" }),
					);
					return;
				}
			}
			for (const guard of editors.getUnsaved()) {
				if (guard.isPending()) return;
				if (!guard.isDirty()) continue;
				if (!(await guard.save())) {
					if (pending.current === request)
						setSaveError(guard.getError() ?? t({ message: "Failed to save" }));
					return;
				}
				if (pending.current !== request) return;
			}
			if (
				documents.getUnsavedDocuments().length === 0 &&
				editors.getUnsaved().length === 0
			)
				finish(true);
		} catch (error) {
			if (pending.current === request) setSaveError(errorMessage(error));
		} finally {
			if (pending.current === request) setSaving(false);
		}
	};
	return (
		<UnsavedChangesDialog
			open={open}
			onOpenChange={(value) => {
				if (!value && !busy) finish(false);
			}}
			onSave={() => void save()}
			onDiscard={() => {
				if (!busy) finish(true);
			}}
			isSaving={busy}
			title={t({ message: "Unsaved changes" })}
			description={t({
				message: "Your changes will be lost if you don't save them.",
			})}
			details={
				<div className="max-h-64 overflow-auto space-y-2 text-sm">
					{unsaved.map((document) => (
						<p className="break-all" key={document.id}>
							{document.absolutePath}
						</p>
					))}
					{editorDrafts.map((guard) => (
						<p key={guard.id} className="break-all">
							{guard.label()}
						</p>
					))}
					{saveError && (
						<p role="alert" className="text-destructive break-all">
							{saveError}
						</p>
					)}
				</div>
			}
			discardLabel={t({ message: "Don't Save" })}
			saveLabel={t({ message: "Save All" })}
		/>
	);
}

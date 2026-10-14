import { Trans, useLingui } from "@lingui/react/macro";
import { Button } from "@superset/ui/button";
import { lazy, Suspense, useEffect, useRef, useSyncExternalStore } from "react";
import { EMPTY_FONT_SETTINGS } from "renderer/lib/font-settings";
import type { SharedFileDocument } from "renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/state/fileDocumentStore/types";
import { detectLanguage } from "shared/detect-language";
import { useWorkstationAppearance } from "../../../../providers/WorkstationPreferencesContext";

const CodeEditorSurface = lazy(() =>
	import(
		"renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/hooks/usePaneRegistry/components/FilePane/registry/views/CodeView/components/CodeEditor/CodeEditorSurface"
	).then((module) => ({ default: module.CodeEditorSurface })),
);

export function RemoteDocumentEditor({
	document,
	active,
	busy,
	revealLine,
	onSave,
	onClose,
	onFocusChange,
	onError,
}: {
	document: SharedFileDocument;
	active: boolean;
	busy: boolean;
	revealLine?: number;
	onSave(): void;
	onClose(): void;
	onFocusChange(): void;
	onError(message: string): void;
}) {
	const { t } = useLingui();
	const appearance = useWorkstationAppearance();
	useSyncExternalStore(
		document.subscribe,
		document.getVersion,
		document.getVersion,
	);
	const errorCallback = useRef(onError);
	errorCallback.current = onError;
	const saveError = document.saveError;
	const conflict = document.conflict;
	const reportedError = useRef<unknown>(null);
	useEffect(() => {
		const current = saveError ?? conflict;
		if (reportedError.current === current) return;
		reportedError.current = current;
		if (saveError) errorCallback.current(saveError.message);
		else if (conflict)
			errorCallback.current(
				t({
					message:
						"This file changed on the remote machine. Your draft is preserved; reload before saving.",
				}),
			);
	}, [saveError, conflict, t]);
	const content = document.content;
	const truncated = content.kind === "too-large";
	const text = content.kind === "text" ? content.value : "";
	return (
		<div
			role="tabpanel"
			id={`file-panel-${document.id}`}
			hidden={!active}
			className="space-y-2"
		>
			<code className="block text-xs break-all">{document.absolutePath}</code>
			{content.kind === "loading" ? (
				<p>
					<Trans>Loading files...</Trans>
				</p>
			) : content.kind === "bytes" ? (
				<p className="text-sm text-muted-foreground">
					<Trans>Binary files cannot be edited here.</Trans>
				</p>
			) : content.kind === "not-found" ? (
				<div role="alert">
					<Trans>File not found</Trans>
				</div>
			) : content.kind === "error" ? (
				<div role="alert">{content.error.message}</div>
			) : (
				<>
					{truncated && (
						<p className="text-sm text-amber-300">
							<Trans>This preview is truncated. Saving is disabled.</Trans>
						</p>
					)}
					<section
						className="h-80 border border-border rounded-md overflow-hidden"
						aria-label={t({ message: "File contents" })}
						onBlur={(event) => {
							if (
								!event.currentTarget.contains(
									event.relatedTarget as Node | null,
								)
							)
								onFocusChange();
						}}
					>
						<Suspense
							fallback={
								<div className="p-3 text-muted-foreground">
									<Trans>Files</Trans>
								</div>
							}
						>
							<CodeEditorSurface
								value={text}
								language={detectLanguage(document.absolutePath)}
								theme={appearance.theme}
								fontSettings={{
									...EMPTY_FONT_SETTINGS,
									...appearance.fontSettings,
								}}
								readOnly={busy || truncated || content.kind !== "text"}
								revealLine={revealLine}
								onChange={(value) => {
									try {
										document.setContent(value);
									} catch (error) {
										onError(String(error));
									}
								}}
								onSave={() => {
									if (!busy && !truncated && document.dirty) onSave();
								}}
							/>
						</Suspense>
					</section>
					<div className="flex gap-2">
						<Button
							variant="outline"
							size="sm"
							disabled={busy || truncated || !document.dirty}
							onClick={onSave}
						>
							<Trans>Save file</Trans>
						</Button>
						<Button
							variant="outline"
							size="sm"
							disabled={busy}
							onClick={onClose}
						>
							<Trans>Close file and discard draft</Trans>
						</Button>
					</div>
				</>
			)}
		</div>
	);
}

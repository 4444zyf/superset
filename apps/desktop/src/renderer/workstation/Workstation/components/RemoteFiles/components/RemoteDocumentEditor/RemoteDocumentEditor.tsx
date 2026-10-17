import { Trans, useLingui } from "@lingui/react/macro";
import { Button } from "@superset/ui/button";
import {
	lazy,
	Suspense,
	useEffect,
	useMemo,
	useRef,
	useState,
	useSyncExternalStore,
} from "react";
import { EMPTY_FONT_SETTINGS } from "renderer/lib/font-settings";
import { FileViewToggle } from "renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/hooks/usePaneRegistry/components/FilePane/components/FileViewToggle/FileViewToggle";
import {
	codeViewLabel,
	markdownPreviewLabel,
} from "renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/hooks/usePaneRegistry/components/FilePane/registry/viewLabels";
import type { SharedFileDocument } from "renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/state/fileDocumentStore/types";
import { getPathDirectory } from "shared/absolute-paths";
import { detectLanguage } from "shared/detect-language";
import { isImageFile, isMarkdownFile } from "shared/file-types";
import { useWorkstationAppearance } from "../../../../providers/WorkstationPreferencesContext";
import type { MarkdownImageResources } from "../RemoteMarkdownPreview/markdown-images";

const CodeEditorSurface = lazy(() =>
	import(
		"renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/hooks/usePaneRegistry/components/FilePane/registry/views/CodeView/components/CodeEditor/CodeEditorSurface"
	).then((module) => ({ default: module.CodeEditorSurface })),
);
const ImageView = lazy(() =>
	import(
		"renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/hooks/usePaneRegistry/components/FilePane/registry/views/ImageView/ImageView"
	).then((module) => ({ default: module.ImageView })),
);

const RemoteMarkdownPreview = lazy(() =>
	import("../RemoteMarkdownPreview/RemoteMarkdownPreview").then((module) => ({
		default: module.RemoteMarkdownPreview,
	})),
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
	markdownResources,
	onOpenUrl,
}: {
	document: SharedFileDocument;
	active: boolean;
	busy: boolean;
	revealLine?: number;
	onSave(): void;
	onClose(): void;
	onFocusChange(): void;
	onError(message: string): void;
	markdownResources?: MarkdownImageResources;
	onOpenUrl?(url: string): Promise<void>;
}) {
	const { t } = useLingui();
	const [markdownView, setMarkdownView] = useState(
		revealLine ? "code" : "markdown-preview",
	);
	useEffect(() => {
		if (active && revealLine) setMarkdownView("code");
	}, [active, revealLine]);
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
	const markdown =
		content.kind === "text" && isMarkdownFile(document.absolutePath);
	const text = content.kind === "text" ? content.value : "";
	const revision = content.kind === "text" ? content.revision : undefined;
	const previewResources = useMemo(
		() =>
			markdownResources
				? {
						documentDirectory: getPathDirectory(document.absolutePath),
						rootPath: markdownResources.rootPath,
						revision,
						readFile: (path: string) =>
							markdownResources.readFile(path, revision),
					}
				: undefined,
		[markdownResources, document.absolutePath, revision],
	);

	return (
		<div
			role="tabpanel"
			tabIndex={-1}
			id={`file-panel-${document.id}`}
			hidden={!active}
			className="space-y-2"
		>
			<code className="block text-xs break-all">{document.absolutePath}</code>
			{markdown && (
				<FileViewToggle
					views={[
						{ id: "code", label: codeViewLabel },
						{ id: "markdown-preview", label: markdownPreviewLabel },
					]}
					activeViewId={markdownView}
					filePath={document.absolutePath}
					onChange={setMarkdownView}
				/>
			)}
			{content.kind === "loading" ? (
				<p>
					<Trans>Loading files...</Trans>
				</p>
			) : content.kind === "bytes" && isImageFile(document.absolutePath) ? (
				<section
					className="h-80 border border-border rounded-md overflow-hidden"
					data-remote-image-preview
				>
					<Suspense fallback={<Trans>Files</Trans>}>
						<ImageView
							key={document.id}
							document={document}
							filePath={document.absolutePath}
							workspaceId={document.workspaceId}
							paneId={document.id}
							isActive={active}
							onChangeView={() => {}}
							onForceView={() => {}}
						/>
					</Suspense>
				</section>
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
							{markdown && markdownView === "markdown-preview" ? (
								<RemoteMarkdownPreview
									key={markdownResources?.owner ?? document.id}
									document={document}
									active={active}
									busy={busy}
									onSave={onSave}
									onFocusChange={onFocusChange}
									onError={onError}
									resources={previewResources}
									onOpenUrl={onOpenUrl}
								/>
							) : (
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
							)}
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

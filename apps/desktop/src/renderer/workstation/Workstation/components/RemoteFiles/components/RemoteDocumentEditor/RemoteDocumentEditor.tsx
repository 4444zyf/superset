import { Trans, useLingui } from "@lingui/react/macro";
import { errorMessage } from "@superset/i18n/errors";
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
import { FileSaveConflictDialogSurface } from "renderer/components/FileSaveConflictDialog/components/FileSaveConflictDialogSurface";
import { EMPTY_FONT_SETTINGS } from "renderer/lib/font-settings";
import { ExternalChangeBanner } from "renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/hooks/usePaneRegistry/components/FilePane/components/ExternalChangeBanner";
import { FileViewToggle } from "renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/hooks/usePaneRegistry/components/FilePane/components/FileViewToggle/FileViewToggle";
import { OrphanedBanner } from "renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/hooks/usePaneRegistry/components/FilePane/components/OrphanedBanner";
import { SaveErrorBanner } from "renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/hooks/usePaneRegistry/components/FilePane/components/SaveErrorBanner";
import {
	codeViewLabel,
	markdownPreviewLabel,
} from "renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/hooks/usePaneRegistry/components/FilePane/registry/viewLabels";
import type {
	ConflictResolution,
	SharedFileDocument,
} from "renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/state/fileDocumentStore/types";
import { getPathDirectory } from "shared/absolute-paths";
import { detectLanguage } from "shared/detect-language";
import {
	isImageFile,
	isMarkdownFile,
	isPdfFile,
	isVideoFile,
} from "shared/file-types";
import { useWorkstationAppearance } from "../../../../providers/WorkstationPreferencesContext";
import type { MarkdownImageResources } from "../RemoteMarkdownPreview/markdown-images";

const LightDiffSurface = lazy(() =>
	import(
		"renderer/screens/main/components/WorkspaceView/ChangesContent/components/LightDiffViewer/components/LightDiffSurface/LightDiffSurface"
	).then((module) => ({ default: module.LightDiffSurface })),
);

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

const PdfView = lazy(() =>
	import(
		"renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/hooks/usePaneRegistry/components/FilePane/registry/views/PdfView/PdfView"
	).then((module) => ({ default: module.PdfView })),
);
const VideoView = lazy(() =>
	import(
		"renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/hooks/usePaneRegistry/components/FilePane/registry/views/VideoView/VideoView"
	).then((module) => ({ default: module.VideoView })),
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
	onResolveConflict,
	canOverwrite = false,
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
	onResolveConflict?(choice: ConflictResolution): Promise<void>;
	canOverwrite?: boolean;
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
	const resolve = async (choice: ConflictResolution) => {
		try {
			if (onResolveConflict) await onResolveConflict(choice);
			else await document.resolveConflict(choice);
		} catch (error) {
			errorCallback.current(errorMessage(error));
		}
	};
	const content = document.content;
	const truncated = content.kind === "too-large";
	const markdown =
		content.kind === "text" && isMarkdownFile(document.absolutePath);
	const text = content.kind === "text" ? content.value : "";
	const image = isImageFile(document.absolutePath),
		pdf = isPdfFile(document.absolutePath),
		video = isVideoFile(document.absolutePath);
	const MediaView = image
		? ImageView
		: pdf
			? PdfView
			: video
				? VideoView
				: null;
	const mediaKind = image ? "image" : pdf ? "pdf" : video ? "video" : null;

	const revision = content.kind === "text" ? content.revision : undefined;
	const previewResources = useMemo(
		() =>
			markdownResources
				? {
						documentDirectory: getPathDirectory(document.absolutePath),
						rootPath: markdownResources.rootPath,
						revision: JSON.stringify([revision, markdownResources.revision]),
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
			<FileSaveConflictDialogSurface
				open={active && conflict !== null}
				filePath={document.absolutePath}
				localContent={content.kind === "text" ? content.value : ""}
				diskContent={conflict?.diskContent ?? null}
				isSaving={document.pendingSave}
				overwriteDisabled={!canOverwrite}
				onOpenChange={(open) => {
					if (!open) void resolve("keep");
				}}
				onKeepEditing={() => void resolve("keep")}
				onReloadFromDisk={() => void resolve("reload")}
				onOverwrite={() => void resolve("overwrite")}
				renderDiff={(contents, filePath) => (
					<Suspense fallback={<Trans>Loading files...</Trans>}>
						<LightDiffSurface
							contents={contents}
							filePath={filePath}
							viewMode="side-by-side"
							hideUnchangedRegions={false}
							theme={appearance.theme}
							fontSettings={appearance.fontSettings}
						/>
					</Suspense>
				)}
			/>
			<code className="block text-xs break-all">{document.absolutePath}</code>
			{document.hasExternalChange && !document.orphaned && (
				<ExternalChangeBanner
					onCompare={() => void document.compareWithDisk()}
				/>
			)}
			{saveError && (
				<SaveErrorBanner
					message={errorMessage(saveError)}
					onRetry={onSave}
					onDismiss={() => document.clearSaveError()}
				/>
			)}
			{document.orphaned && (
				<OrphanedBanner
					dirty={document.dirty}
					onDiscard={() => void document.reload()}
				/>
			)}
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
			) : content.kind === "bytes" && MediaView !== null ? (
				<section
					className="h-80 border border-border rounded-md overflow-hidden"
					data-remote-image-preview={image ? true : undefined}
					data-remote-media-preview={mediaKind}
				>
					<Suspense fallback={<Trans>Files</Trans>}>
						<MediaView
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
										if (
											!busy &&
											!truncated &&
											(document.dirty || document.orphaned)
										)
											onSave();
									}}
								/>
							)}
						</Suspense>
					</section>
					<div className="flex gap-2">
						<Button
							variant="outline"
							size="sm"
							disabled={
								busy || truncated || (!document.dirty && !document.orphaned)
							}
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

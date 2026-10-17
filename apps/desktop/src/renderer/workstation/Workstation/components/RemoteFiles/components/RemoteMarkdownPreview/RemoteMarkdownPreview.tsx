import { Trans, useLingui } from "@lingui/react/macro";
import { useEffect, useRef } from "react";
import { TipTapMarkdownSurface } from "renderer/components/MarkdownRenderer/components/TipTapMarkdownSurface";
import {
	MarkdownResourceProvider,
	type MarkdownResources,
} from "renderer/components/MarkdownRenderer/providers/MarkdownResourceProvider";
import { splitFrontMatter } from "renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/hooks/usePaneRegistry/components/FilePane/registry/views/MarkdownPreviewView/splitFrontMatter";
import type { SharedFileDocument } from "renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/state/fileDocumentStore/types";
import { MarkdownSearch } from "renderer/screens/main/components/WorkspaceView/ContentView/TabsContent/TabView/FileViewerPane/components/MarkdownSearch";
import { useTextSearch } from "renderer/screens/main/components/WorkspaceView/ContentView/TabsContent/TabView/hooks/useTextSearch";
import { useWorkstationAppearance } from "../../../../providers/WorkstationPreferencesContext";

export function RemoteMarkdownPreview({
	document,
	active,
	busy,
	onSave,
	onFocusChange,
	onError,
	onOpenUrl,
	resources,
}: {
	document: SharedFileDocument;
	active: boolean;
	busy: boolean;
	onSave(): void;
	onFocusChange(): void;
	onError(message: string): void;
	onOpenUrl?(url: string): Promise<void>;
	resources?: MarkdownResources;
}) {
	const appearance = useWorkstationAppearance();
	const { t } = useLingui();
	const containerRef = useRef<HTMLDivElement>(null);
	const search = useTextSearch({
		containerRef,
		highlightPrefix: "workstation-markdown",
	});
	useEffect(() => {
		if (!active) search.closeSearch();
	}, [active, search.closeSearch]);
	if (document.content.kind !== "text") return null;
	const { frontMatter, body } = splitFrontMatter(document.content.value);
	const content = (
		<TipTapMarkdownSurface
			value={body}
			editable={!busy}
			isDark={appearance.theme.type !== "light"}
			preserveSourceFormatting
			getLinkAction={(event) =>
				event.metaKey || event.ctrlKey ? "external" : null
			}
			onOpenUrl={(url) => {
				void onOpenUrl?.(url).catch((error) => onError(String(error)));
			}}
			onChange={(next) => {
				if (busy) return;
				try {
					document.setContent(frontMatter + next);
				} catch (error) {
					onError(String(error));
				}
			}}
			onSave={() => {
				if (!busy && document.dirty) onSave();
			}}
		/>
	);
	return (
		<section
			aria-label={t({ message: "Preview" })}
			data-remote-markdown-preview
			className="relative h-full"
			onKeyDownCapture={(event) => {
				if (
					active &&
					(event.metaKey || event.ctrlKey) &&
					!event.altKey &&
					event.key.toLowerCase() === "f"
				) {
					event.preventDefault();
					event.stopPropagation();
					search.setIsSearchOpen((open) => !open);
				}
			}}
			onBlur={(event) => {
				if (!event.currentTarget.contains(event.relatedTarget as Node | null))
					onFocusChange();
			}}
		>
			<MarkdownSearch
				isOpen={search.isSearchOpen}
				query={search.query}
				caseSensitive={search.caseSensitive}
				matchCount={search.matchCount}
				activeMatchIndex={search.activeMatchIndex}
				onQueryChange={search.setQuery}
				onCaseSensitiveChange={search.setCaseSensitive}
				onFindNext={search.findNext}
				onFindPrevious={search.findPrevious}
				onClose={search.closeSearch}
			/>
			<div ref={containerRef} className="h-full overflow-auto p-4">
				{frontMatter !== "" && (
					<p className="mb-2 text-xs text-muted-foreground">
						<Trans>
							Front matter hidden — switch to the Markdown view to edit it
						</Trans>
					</p>
				)}
				{resources ? (
					<MarkdownResourceProvider {...resources}>
						{content}
					</MarkdownResourceProvider>
				) : (
					content
				)}
			</div>
		</section>
	);
}

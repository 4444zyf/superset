import { useLingui } from "@lingui/react/macro";
import {
	createWorkspaceStore,
	type Tab,
	WorkspaceTabBar,
} from "@superset/panes";
import { File } from "lucide-react";
import { useContext, useEffect, useMemo } from "react";
import { DndContext, DndProvider } from "react-dnd";
import { HTML5Backend } from "react-dnd-html5-backend";
import type { SharedFileDocument } from "renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/state/fileDocumentStore/types";

export function RemoteFileTabs({
	documents,
	activeId,
	onSelect,
	onClose,
	onOrder,
	onRename,
	labels,
}: {
	documents: SharedFileDocument[];
	activeId: string | null;
	onSelect(id: string): void;
	onClose(ids: string[]): void;
	onOrder(id: string, index: number): void;
	onRename(id: string, name: string | undefined): void;
	labels: Record<string, string>;
}) {
	const { t } = useLingui();
	const { dragDropManager } = useContext(DndContext);
	const store = useMemo(() => createWorkspaceStore<string>(), []);
	const tabs: Tab<string>[] = documents.map((document) => ({
		id: document.id,
		titleOverride:
			labels[document.id] ?? document.absolutePath.split("/").at(-1),
		createdAt: 0,
		activePaneId: document.id,
		layout: { type: "pane", paneId: document.id },
		panes: {
			[document.id]: {
				id: document.id,
				kind: "file",
				data: document.absolutePath,
			},
		},
	}));
	useEffect(
		() =>
			store
				.getState()
				.replaceState({ version: 1, tabs, activeTabId: activeId }),
		[store, tabs, activeId],
	);
	const content = (
		<div role="tablist" aria-label={t({ message: "Files" })}>
			<WorkspaceTabBar
				store={store}
				tabs={tabs}
				registry={{}}
				activeTabId={activeId}
				hideAddTabButton
				deferMenuActions
				canDropItem={(item) => item.store === store && Boolean(item.tabId)}
				onSelectTab={onSelect}
				onCloseTab={(id) => onClose([id])}
				onCloseOtherTabs={(id) =>
					onClose(
						documents
							.filter((document) => document.id !== id)
							.map((document) => document.id),
					)
				}
				onCloseAllTabs={() => onClose(documents.map((document) => document.id))}
				onRenameTab={onRename}
				onReorderTab={onOrder}
				onMovePaneToNewTab={() => {}}
				renderTabIcon={() => <File size={14} />}
				renderTabAccessory={(tab) =>
					documents.find((document) => document.id === tab.id)?.dirty ? (
						<span className="text-primary">●</span>
					) : null
				}
				getTabElementProps={(tab) => ({
					role: "tab",
					"aria-label": tab.titleOverride,
					"aria-selected": tab.id === activeId,
					tabIndex: tab.id === activeId ? 0 : -1,
					"aria-controls": `file-panel-${tab.id}`,
					onKeyDown: (event) => {
						if (
							event.target !== event.currentTarget ||
							event.nativeEvent.isComposing ||
							event.metaKey ||
							event.ctrlKey ||
							event.altKey
						)
							return;
						if (event.key === "Enter" || event.key === " ") {
							event.preventDefault();
							onSelect(tab.id);
						}
						if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
							event.preventDefault();
							const index = tabs.findIndex((value) => value.id === tab.id);
							const next =
								tabs[
									(index + (event.key === "ArrowLeft" ? -1 : 1) + tabs.length) %
										tabs.length
								];
							onSelect(next.id);
							event.currentTarget
								.closest("[role=tablist]")
								?.querySelector<HTMLElement>(`[data-tab-id="${next.id}"]`)
								?.focus();
						}
					},
				})}
			/>
		</div>
	);
	return dragDropManager ? (
		content
	) : (
		<DndProvider backend={HTML5Backend}>{content}</DndProvider>
	);
}

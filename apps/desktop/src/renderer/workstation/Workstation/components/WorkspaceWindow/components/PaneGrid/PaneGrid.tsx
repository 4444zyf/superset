import type { ModifierEvent } from "renderer/lib/clickPolicy/types";
import type { BrowserLinkAction } from "shared/workstation-browser-preferences";
import { Trans, useLingui } from "@lingui/react/macro";
import {
	type ContextMenuActionConfig,
	createWorkspaceStore,
	type PaneRegistry,
	Workspace,
	WorkspaceTab,
} from "@superset/panes";
import type { RestoreResourceCheck } from "@superset/shared/workspace-restore";
import { DropdownMenuItem } from "@superset/ui/dropdown-menu";
import { Columns2, Globe, Rows2, X } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useStore } from "zustand";
import type {
	DirectDescriptor,
	DirectWorkstationApi,
} from "../../../../../../../shared/direct-workstation";
import type {
	WorkspacePaneV2 as WorkspacePane,
	WorkspaceViewV2 as WorkspaceView,
} from "../../../../../../../shared/workspace-view-v2";
import type { WorkspaceViewActions } from "../../../../hooks/useWorkspaceViews/useWorkspaceViews";
import {
	fromPaneLayout,
	toPaneState,
} from "../../../../utils/pane-adapter/pane-adapter";
import { paneStateMetadataKey } from "../../../../utils/workspace-pane-state/workspace-pane-state";
import type {
	TerminalClipboardControls,
	TerminalEmulator,
} from "../../../RemoteTerminal/RemoteTerminal";
import type { TerminalFileTarget } from "../../../RemoteTerminal/utils/terminal-file-links/terminal-file-links";

import { WorkspacePaneView } from "../WorkspacePaneView/WorkspacePaneView";
import { isCompactPaneLayout } from "./utils/isCompactPaneLayout/isCompactPaneLayout";

export function PaneGrid({
	api,
	connection,
	workspace,
	checks,
	actions,
	createEmulator,
	onOpenFile,
	onOpenUrl,
	resolveUrlAction,
}: {
	api: DirectWorkstationApi;
	connection: DirectDescriptor | null;
	workspace: WorkspaceView;
	checks: RestoreResourceCheck[];
	actions: WorkspaceViewActions;
	createEmulator?(element: HTMLDivElement): TerminalEmulator;
	onOpenFile?(target: TerminalFileTarget): void;
	onOpenUrl?(url: string, action?: BrowserLinkAction): void;
	resolveUrlAction?(event: ModifierEvent): BrowserLinkAction | null;
}) {
	const { t } = useLingui();
	const terminalClipboards = useRef(
		new Map<string, TerminalClipboardControls>(),
	);
	const current = useRef({ workspace, actions, connection });
	current.current = { workspace, actions, connection };
	const paneScope = workspace.tabId;
	const store = useMemo(() => {
		const store = createWorkspaceStore<WorkspacePane>({
			initialState: toPaneState({
				...current.current.workspace,
				tabId: paneScope,
			}),
		});
		const original = store.getState();
		store.setState({
			setActivePane: (args) => {
				if (store.getState().getTab(args.tabId)?.activePaneId === args.paneId)
					return;
				original.setActivePane(args);
				if (current.current.workspace.paneTabs) return;
				void current.current.actions.focusPane(
					current.current.workspace.workspaceId,
					args.paneId,
				);
			},
			setPaneTitleOverride: (args) => {
				original.setPaneTitleOverride(args);
				if (current.current.workspace.paneTabs) return;
				void current.current.actions.renamePane(
					current.current.workspace.workspaceId,
					args.paneId,
					args.titleOverride ?? "",
				);
			},
			closePane: (args) => {
				if (current.current.workspace.paneTabs) {
					original.closePane(args);
					return;
				}
				void current.current.actions.closePane(
					current.current.workspace.workspaceId,
					args.paneId,
				);
			},
		});
		return store;
	}, [paneScope]);
	const tab = useStore(store, (s) =>
		s.tabs.find((t) => t.id === s.activeTabId),
	);
	const syncing = useRef(false);
	useLayoutEffect(() => {
		syncing.current = true;
		store.getState().replaceState(toPaneState(workspace));
		syncing.current = false;
	}, [store, workspace]);
	useEffect(
		() =>
			store.subscribe((state, previous) => {
				if (syncing.current) return;
				if (current.current.workspace.paneTabs) {
					if (paneStateMetadataKey(state) !== paneStateMetadataKey(previous)) {
						void current.current.actions.savePaneState(
							current.current.workspace.workspaceId,
							state,
							previous,
						);
						return;
					}
					for (const next of state.tabs) {
						if (
							JSON.stringify(next.layout) !==
							JSON.stringify(
								previous.tabs.find((t) => t.id === next.id)?.layout,
							)
						)
							current.current.actions.saveLayout(
								current.current.workspace.workspaceId,
								fromPaneLayout(next.layout),
								false,
								next.id,
							);
					}
					return;
				}
				const next = state.tabs[0];
				if (
					!next ||
					JSON.stringify(next.layout) ===
						JSON.stringify(previous.tabs[0]?.layout)
				)
					return;
				current.current.actions.saveLayout(
					current.current.workspace.workspaceId,
					fromPaneLayout(next.layout),
					false,
				);
			}),
		[store],
	);
	const [width, setWidth] = useState(window.innerWidth);
	const gridRef = useRef<HTMLDivElement>(null);
	const [availableSize, setAvailableSize] = useState<{
		width: number;
		height: number;
	} | null>(null);
	useLayoutEffect(() => {
		const element = gridRef.current;
		if (!element) return;
		const observer = new ResizeObserver(([entry]) => {
			if (
				!entry ||
				entry.contentRect.width <= 0 ||
				entry.contentRect.height <= 0
			)
				return;
			const { width, height } = entry.contentRect;
			setAvailableSize((old) =>
				old?.width === width && old.height === height ? old : { width, height },
			);
		});
		observer.observe(element);
		return () => observer.disconnect();
	}, []);
	const [attached, setAttached] = useState<string[]>([]);
	const [failed, setFailed] = useState<string[]>([]);
	const [overrides, setOverrides] = useState<
		Record<string, RestoreResourceCheck>
	>({});
	const [attempts, setAttempts] = useState<Record<string, number>>({});
	const mounted = useRef(false);
	useEffect(() => {
		mounted.current = true;
		const resized = () => setWidth(window.innerWidth);
		window.addEventListener("resize", resized);
		return () => {
			mounted.current = false;
			window.removeEventListener("resize", resized);
		};
	}, []);
	const groupPanes = workspace.paneTabs
		? workspace.panes.filter((p) => Boolean(tab?.panes[p.paneId]))
		: workspace.panes;
	const groupLayout = workspace.paneTabs
		? tab
			? fromPaneLayout(tab.layout)
			: null
		: workspace.layout;
	const groupSize =
		workspace.paneTabs && availableSize
			? { ...availableSize, height: Math.max(0, availableSize.height - 36) }
			: availableSize;
	const compact = isCompactPaneLayout({
		viewportWidth: width,
		paneCount: groupPanes.length,
		layout: groupLayout,
		availableSize: groupSize,
	});
	const visible = compact
		? groupPanes.filter(
				(p) => p.paneId === (tab?.activePaneId ?? groupPanes[0]?.paneId),
			)
		: groupPanes;
	const checkFor = (paneId: string) => {
		const pane = workspace.panes.find((p) => p.paneId === paneId);
		return (
			overrides[paneId] ??
			checks.find(
				(c) =>
					c.workspaceId === workspace.workspaceId &&
					c.kind === pane?.kind &&
					c.resourceId === pane?.resourceId,
			)
		);
	};
	const pending = visible.filter(
		(p) =>
			checkFor(p.paneId)?.state === "live" &&
			(p.kind === "chat" ||
				(!!p.executionId &&
					checkFor(p.paneId)?.executionId === p.executionId)) &&
			!attached.includes(p.paneId) &&
			!failed.includes(p.paneId),
	);
	const visibleKey = JSON.stringify(
		visible.map((p) => [
			p.paneId,
			p.kind,
			p.resourceId,
			p.executionId,
			connection?.connectionId,
			connection?.backendId,
			connection?.namespaceId,
			connection?.generation,
		]),
	);
	const previousVisible = useRef(new Map<string, string>());
	useLayoutEffect(() => {
		const next = new Map(
			(JSON.parse(visibleKey) as [string, ...unknown[]][]).map(
				([id, ...identity]) => [id, JSON.stringify(identity)],
			),
		);
		const retained = new Set(
			[...next.keys()].filter(
				(id) => previousVisible.current.get(id) === next.get(id),
			),
		);
		previousVisible.current = next;
		setAttached((old) => old.filter((id) => retained.has(id)));
		setFailed((old) => old.filter((id) => retained.has(id)));
		setOverrides((old) =>
			Object.fromEntries(
				Object.entries(old).filter(([id]) => retained.has(id)),
			),
		);
		setAttempts((old) =>
			Object.fromEntries(
				Object.entries(old).filter(([id]) => retained.has(id)),
			),
		);
	}, [visibleKey]);
	const allowed = new Set([
		...attached,
		...pending.slice(0, 4).map((p) => p.paneId),
	]);
	const retry = async (paneId: string) => {
		if (!connection) {
			await actions.restoreManual();
			return;
		}
		const pane = workspace.panes.find((p) => p.paneId === paneId);
		if (!pane || pane.kind === "browser") return;

		const stillCurrent = () => {
			const latest = current.current.workspace.panes.find(
				(p) => p.paneId === paneId,
			);
			return (
				current.current.connection === connection &&
				current.current.workspace.workspaceId === workspace.workspaceId &&
				latest?.kind === pane.kind &&
				latest.resourceId === pane.resourceId &&
				latest.executionId === pane.executionId
			);
		};
		const ref = {
			workspaceId: workspace.workspaceId,
			resourceId: pane.resourceId,
			kind: pane.kind,
			...(pane.executionId ? { executionId: pane.executionId } : {}),
		};
		try {
			const checked = await api.rpc<RestoreResourceCheck[]>({
				connectionId: connection.connectionId,
				generation: connection.generation,
				path: "workspace.restoreResources",
				type: "query",
				input: { refs: [ref] },
			});
			if (!mounted.current || !stillCurrent()) return;
			setOverrides((old) => ({
				...old,
				[paneId]: checked[0] ?? { ...ref, state: "unknown" },
			}));
			setAttached((old) => old.filter((id) => id !== paneId));
			setFailed((old) => old.filter((id) => id !== paneId));
			setAttempts((old) => ({ ...old, [paneId]: (old[paneId] ?? 0) + 1 }));
		} catch {
			if (mounted.current && stillCurrent())
				setOverrides((old) => ({
					...old,
					[paneId]: { ...ref, state: "unknown" },
				}));
		}
	};
	const renderPane = (id: string) => {
		const pane = workspace.panes.find((p) => p.paneId === id);
		if (!pane) return null;
		return (
			<WorkspacePaneView
				key={`${connection?.connectionId}:${connection?.backendId}:${connection?.namespaceId}:${connection?.generation}:${id}:${pane.kind}:${pane.resourceId}:${pane.executionId}:${attempts[id] ?? 0}`}
				api={api}
				actions={actions}
				connection={connection}
				workspaceId={workspace.workspaceId}
				pane={pane}
				check={checkFor(id)}
				active={tab?.activePaneId === id}
				allowed={allowed.has(id)}
				createEmulator={createEmulator}
				onOpenFile={onOpenFile}
				onOpenUrl={onOpenUrl}
				resolveUrlAction={resolveUrlAction}
				onClipboardControls={(clipboard) => {
					terminalClipboards.current.set(id, clipboard);
					return () => {
						if (terminalClipboards.current.get(id) === clipboard)
							terminalClipboards.current.delete(id);
					};
				}}
				onFocus={() => {
					void actions.focusPane(workspace.workspaceId, id);
				}}
				onChat={(resourceId) => {
					void actions.selectChat(workspace.workspaceId, id, resourceId);
				}}
				onRetry={() => {
					void retry(id);
				}}
				onAttached={() => {
					if (mounted.current)
						setAttached((old) => (old.includes(id) ? old : [...old, id]));
				}}
				onFailed={() => {
					if (mounted.current)
						setFailed((old) => (old.includes(id) ? old : [...old, id]));
				}}
			/>
		);
	};
	const titleFor = (pane: WorkspacePane) =>
		pane.label ??
		(pane.kind === "browser"
			? pane.browser.pageTitle || t({ message: "Browser" })
			: labelsForPane(pane));
	const labelsForPane = (pane: WorkspacePane) =>
		pane.kind === "chat" ? t({ message: "Chat" }) : t({ message: "Terminal" });
	const definition: PaneRegistry<WorkspacePane>[string] = {
		canDrop: (item) =>
			item.store === store &&
			!!item.paneId &&
			!!store.getState().getPane(item.paneId),
		getTitle: (pane) => pane.titleOverride ?? titleFor(pane.data),
		getIcon: ({ pane }) =>
			pane.kind === "browser" ? (
				<Globe size={12} />
			) : pane.kind === "terminal" ? (
				<Columns2 size={12} />
			) : (
				<Rows2 size={12} />
			),
		renderTitle: ({ pane, actions: paneActions }) => (
			<input
				className="min-w-0 w-full bg-transparent text-xs outline-none"
				aria-label={t({ message: "Title" })}
				maxLength={128}
				data-pane-title-id={pane.id}
				key={`${pane.id}:${pane.titleOverride}:${pane.kind === "browser" ? (pane.data.kind === "browser" ? pane.data.browser.pageTitle : "") : ""}`}
				defaultValue={pane.titleOverride ?? titleFor(pane.data)}
				onPointerDown={(e) => e.stopPropagation()}
				onBlur={(e) => {
					if (
						e.currentTarget.value !==
						(pane.titleOverride ?? titleFor(pane.data))
					)
						paneActions.setTitle(e.currentTarget.value);
				}}
			/>
		),
		renderPane: ({ pane }) => renderPane(pane.id),
		renderHeaderExtras: ({ pane }) =>
			connection && attached.includes(pane.id) && !failed.includes(pane.id) ? (
				<span
					className="size-1.5 shrink-0 rounded-full bg-success"
					role="img"
					aria-label={t({ message: "Connected" })}
				/>
			) : null,
		onHeaderClick: ({ actions }) => actions.focus(),
	};
	const paneActions = [
		{
			key: "split-horizontal",
			icon: <Columns2 size={12} />,
			tooltip: t({ message: "Split horizontally" }),
			onClick: () => {
				if (connection?.capabilities?.durableOperations && !actions.busy)
					void actions.newTerminal(workspace.workspaceId, "horizontal");
			},
		},
		{
			key: "split-vertical",
			icon: <Rows2 size={12} />,
			tooltip: t({ message: "Split vertically" }),
			onClick: () => {
				if (connection?.capabilities?.durableOperations && !actions.busy)
					void actions.newTerminal(workspace.workspaceId, "vertical");
			},
		},
		{
			key: "close",
			icon: <X size={12} />,
			tooltip: t({ message: "Close pane" }),
			onClick: ({ actions }: { actions: { close(): void } }) => actions.close(),
		},
	];
	const contextMenuActions: ContextMenuActionConfig<WorkspacePane>[] = [
		{
			key: "copy",
			label: t({ message: "Copy" }),
			hidden: ({ pane }) => pane.kind !== "terminal",
			disabled: ({ pane }) =>
				!terminalClipboards.current.get(pane.id)?.canCopy(),
			onSelect: ({ pane }) => terminalClipboards.current.get(pane.id)?.copy(),
		},
		{
			key: "paste",
			label: t({ message: "Paste" }),
			hidden: ({ pane }) => pane.kind !== "terminal",
			disabled: ({ pane }) =>
				!terminalClipboards.current.get(pane.id)?.canPaste(),
			onSelect: ({ pane, actions }) => {
				actions.focus();
				terminalClipboards.current.get(pane.id)?.paste();
			},
		},

		{
			key: "horizontal",
			label: t({ message: "Split horizontally" }),
			onSelect: () => {
				if (connection?.capabilities?.durableOperations && !actions.busy)
					void actions.newTerminal(workspace.workspaceId, "horizontal");
			},
			disabled: !connection?.capabilities?.durableOperations || actions.busy,
		},
		{
			key: "vertical",
			label: t({ message: "Split vertically" }),
			onSelect: () => {
				if (connection?.capabilities?.durableOperations && !actions.busy)
					void actions.newTerminal(workspace.workspaceId, "vertical");
			},
			disabled: !connection?.capabilities?.durableOperations || actions.busy,
		},
		{
			key: "close",
			label: t({ message: "Close pane" }),
			onSelect: ({ actions }) => actions.close(),
		},
	];

	const compactNavigation = compact && (
		<nav className="ws-compact-panes">
			{groupPanes.map((p) => (
				<button
					type="button"
					key={p.paneId}
					className={tab?.activePaneId === p.paneId ? "active" : ""}
					onClick={() =>
						store.getState().setActivePane({
							tabId: tab?.id ?? workspace.tabId,
							paneId: p.paneId,
						})
					}
				>
					{titleFor(p)}
				</button>
			))}
		</nav>
	);

	return (
		<div ref={gridRef} className="ws-pane-grid">
			{workspace.paneTabs ? (
				<div
					data-workstation-pane-tabs
					className="flex min-h-0 flex-1 flex-col"
				>
					<Workspace
						store={store}
						registry={{
							terminal: definition,
							chat: definition,
							browser: definition,
						}}
						canDropItem={(item) => item.store === store}
						transformDisplayedTab={(displayed) =>
							isCompactPaneLayout({
								viewportWidth: width,
								paneCount: Object.keys(displayed.panes).length,
								layout: fromPaneLayout(displayed.layout),
								availableSize: groupSize,
							}) && displayed.activePaneId
								? {
										...displayed,
										layout: { type: "pane", paneId: displayed.activePaneId },
									}
								: displayed
						}
						renderBelowTabBar={() => compactNavigation}
						renderTabIcon={(tab) =>
							Object.values(tab.panes).every((p) => p.kind === "browser") ? (
								<Globe size={14} />
							) : (
								<Columns2 size={14} />
							)
						}
						renderAddTabMenu={() => (
							<DropdownMenuItem
								disabled={
									!connection?.capabilities?.durableOperations || actions.busy
								}
								onSelect={() =>
									void actions.newTerminal(
										workspace.workspaceId,
										"horizontal",
										undefined,
										{ placement: "new-tab" },
									)
								}
							>
								<Trans>New terminal</Trans>
							</DropdownMenuItem>
						)}
						renderEmptyState={() => <Trans>New terminal</Trans>}
						paneActions={
							connection?.capabilities?.durableOperations && !actions.busy
								? paneActions
								: paneActions.filter((a) => a.key === "close")
						}
						contextMenuActions={contextMenuActions}
					/>
				</div>
			) : (
				<>
					{compactNavigation}
					<div className="ws-pane-layout">
						{tab ? (
							<WorkspaceTab
								store={store}
								tab={
									compact && tab.activePaneId
										? {
												...tab,
												layout: { type: "pane", paneId: tab.activePaneId },
											}
										: tab
								}
								registry={{
									terminal: definition,
									chat: definition,
									browser: definition,
								}}
								paneActions={
									connection?.capabilities?.durableOperations && !actions.busy
										? paneActions
										: paneActions.filter((a) => a.key === "close")
								}
								contextMenuActions={contextMenuActions}
							/>
						) : (
							<div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
								<Trans>New terminal</Trans>
							</div>
						)}
					</div>
				</>
			)}
		</div>
	);
}

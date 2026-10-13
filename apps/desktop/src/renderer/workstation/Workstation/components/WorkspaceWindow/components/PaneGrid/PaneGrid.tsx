import { Trans, useLingui } from "@lingui/react/macro";
import {
	createWorkspaceStore,
	type PaneRegistry,
	WorkspaceTab,
} from "@superset/panes";
import type { RestoreResourceCheck } from "@superset/shared/workspace-restore";
import { Columns2, Rows2, X } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useStore } from "zustand";
import type {
	DirectDescriptor,
	DirectWorkstationApi,
} from "../../../../../../../shared/direct-workstation";
import type {
	WorkspacePane,
	WorkspaceView,
} from "../../../../../../../shared/workspace-view";
import type { WorkspaceViewActions } from "../../../../hooks/useWorkspaceViews/useWorkspaceViews";
import type { TerminalEmulator } from "../../../RemoteTerminal/RemoteTerminal";
import {
	fromPaneLayout,
	toPaneState,
} from "../../utils/pane-adapter/pane-adapter";

import { WorkspacePaneView } from "../WorkspacePaneView/WorkspacePaneView";

export function PaneGrid({
	api,
	connection,
	workspace,
	checks,
	actions,
	createEmulator,
}: {
	api: DirectWorkstationApi;
	connection: DirectDescriptor | null;
	workspace: WorkspaceView;
	checks: RestoreResourceCheck[];
	actions: WorkspaceViewActions;
	createEmulator?(element: HTMLDivElement): TerminalEmulator;
}) {
	const { t } = useLingui();
	const current = useRef({ workspace, actions });
	current.current = { workspace, actions };
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
				void current.current.actions.focusPane(
					current.current.workspace.workspaceId,
					args.paneId,
				);
			},
			setPaneTitleOverride: (args) => {
				original.setPaneTitleOverride(args);
				void current.current.actions.renamePane(
					current.current.workspace.workspaceId,
					args.paneId,
					args.titleOverride ?? "",
				);
			},
			closePane: (args) => {
				void current.current.actions.closePane(
					current.current.workspace.workspaceId,
					args.paneId,
				);
			},
		});
		return store;
	}, [paneScope]);
	const tab = useStore(store, (s) => s.tabs[0]);
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
	const compact = width < 1000 || workspace.panes.length > 8;
	const visible = compact
		? workspace.panes.filter(
				(p) =>
					p.paneId === (workspace.activePaneId ?? workspace.panes[0]?.paneId),
			)
		: workspace.panes;
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
	const visibleKey = JSON.stringify(visible.map((p) => p.paneId));
	useLayoutEffect(() => {
		const ids = new Set(JSON.parse(visibleKey));
		setAttached((old) => old.filter((id) => ids.has(id)));
		setFailed((old) => old.filter((id) => ids.has(id)));
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
		if (!pane) return;
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
			if (!mounted.current) return;
			setOverrides((old) => ({
				...old,
				[paneId]: checked[0] ?? { ...ref, state: "unknown" },
			}));
			setAttached((old) => old.filter((id) => id !== paneId));
			setFailed((old) => old.filter((id) => id !== paneId));
			setAttempts((old) => ({ ...old, [paneId]: (old[paneId] ?? 0) + 1 }));
		} catch {
			if (mounted.current)
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
				key={`${id}:${attempts[id] ?? 0}`}
				api={api}
				connection={connection}
				workspaceId={workspace.workspaceId}
				pane={pane}
				check={checkFor(id)}
				active={tab?.activePaneId === id}
				allowed={allowed.has(id)}
				createEmulator={createEmulator}
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
	const definition: PaneRegistry<WorkspacePane>[string] = {
		canDrop: (item) =>
			item.store === store &&
			!!item.paneId &&
			!!store.getState().getPane(item.paneId),
		getTitle: (pane) => pane.titleOverride ?? pane.data.label,
		getIcon: ({ pane }) =>
			pane.kind === "terminal" ? <Columns2 size={12} /> : <Rows2 size={12} />,
		renderTitle: ({ pane, actions: paneActions }) => (
			<input
				className="min-w-0 w-full bg-transparent text-xs outline-none"
				aria-label={t({ message: "Title" })}
				maxLength={128}
				data-pane-title-id={pane.id}
				key={`${pane.id}:${pane.titleOverride}`}
				defaultValue={pane.titleOverride ?? pane.data.label}
				onPointerDown={(e) => e.stopPropagation()}
				onBlur={(e) => {
					if (e.currentTarget.value !== pane.titleOverride)
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
	return (
		<div className="ws-pane-grid">
			{compact && (
				<nav className="ws-compact-panes">
					{workspace.panes.map((p) => (
						<button
							type="button"
							key={p.paneId}
							className={tab?.activePaneId === p.paneId ? "active" : ""}
							onClick={() =>
								store
									.getState()
									.setActivePane({ tabId: workspace.tabId, paneId: p.paneId })
							}
						>
							{p.label ?? <Trans>Terminal</Trans>}
						</button>
					))}
				</nav>
			)}
			<div className="ws-pane-layout">
				{tab ? (
					<WorkspaceTab
						store={store}
						tab={
							compact && tab.activePaneId
								? { ...tab, layout: { type: "pane", paneId: tab.activePaneId } }
								: tab
						}
						registry={{ terminal: definition, chat: definition }}
						paneActions={
							connection?.capabilities?.durableOperations && !actions.busy
								? paneActions
								: paneActions.filter((a) => a.key === "close")
						}
						contextMenuActions={[
							{
								key: "horizontal",
								label: t({ message: "Split horizontally" }),
								onSelect: () => {
									if (
										connection?.capabilities?.durableOperations &&
										!actions.busy
									)
										void actions.newTerminal(
											workspace.workspaceId,
											"horizontal",
										);
								},
								disabled:
									!connection?.capabilities?.durableOperations || actions.busy,
							},
							{
								key: "vertical",
								label: t({ message: "Split vertically" }),
								onSelect: () => {
									if (
										connection?.capabilities?.durableOperations &&
										!actions.busy
									)
										void actions.newTerminal(workspace.workspaceId, "vertical");
								},
								disabled:
									!connection?.capabilities?.durableOperations || actions.busy,
							},
							{
								key: "close",
								label: t({ message: "Close pane" }),
								onSelect: ({ actions }) => actions.close(),
							},
						]}
					/>
				) : (
					<div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
						<Trans>New terminal</Trans>
					</div>
				)}
			</div>
		</div>
	);
}

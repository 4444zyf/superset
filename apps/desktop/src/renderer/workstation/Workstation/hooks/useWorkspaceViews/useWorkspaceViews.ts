import { preserveBrowserOpenSelection } from "../../utils/workspace-browser-open/workspace-browser-open-selection";
import { useLingui } from "@lingui/react/macro";
import type {
	HostAgentConfig,
	HostTerminalPreset,
	HostTerminalPresetCatalog,
} from "@superset/host-service/settings";
import { formatNumber } from "@superset/i18n/format";
import { createWorkspaceStore, type WorkspaceState } from "@superset/panes";
import { buildTerminalCommand } from "@superset/shared/terminal-command";
import type { RestoreResourceCheck } from "@superset/shared/workspace-restore";
import { useCallback, useEffect, useRef, useState } from "react";
import { resolvePresetLaunchCommands } from "renderer/lib/agent-launch-command";
import {
	buildFocusedTerminalCommand,
	getPresetLaunchPlan,
	shouldApplyPresetPaneName,
} from "renderer/stores/tabs/preset-launch";
import { toAbsoluteWorkspacePath } from "shared/absolute-paths";
import { presetMatchesProjectId } from "shared/preset-project-targeting";
import { getPresetsForTriggerField } from "shared/preset-trigger-selection";
import type {
	DirectDescriptor,
	DirectWorkstationApi,
} from "../../../../../shared/direct-workstation";
import {
	emptyWorkspaceView,
	type PaneTree,
	type WorkspaceRestoreSnapshot,
} from "../../../../../shared/workspace-view";
import type {
	WorkspacePaneV2 as WorkspacePane,
	WorkspaceViewInputV2 as WorkspaceViewInput,
	WorkspaceViewSnapshotV2 as WorkspaceViewSnapshot,
} from "../../../../../shared/workspace-view-v2";
import type { RemoteWorkspace } from "../../types";
import { sanitizeUrl } from "renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/hooks/usePaneRegistry/components/BrowserPane/sanitizeUrl";
import { hasBrowserPanes } from "../../../../../shared/workspace-view-v2";
import type { WorkstationBrowserPane } from "../../../../../shared/workstation-browser";
import type { BrowserPageState } from "../../../../../shared/workspace-view-v2";
import {
	fromPaneLayout,
	toPaneLayout,
	toPaneState,
} from "../../utils/pane-adapter/pane-adapter";
import {
	buildPaneTree,
	removePane,
	splitPane,
} from "../../utils/pane-layout/pane-layout";
import { applyWorkspacePaneState } from "../../utils/workspace-pane-state/workspace-pane-state";

type PageUpdate = {
	pane: WorkstationBrowserPane;
	resourceId: string;
	state: BrowserPageState;
};
const pageKey = (update: PageUpdate) =>
	JSON.stringify([
		update.pane.connectionId,
		update.pane.generation,
		update.pane.workspaceId,
		update.pane.paneId,
		update.pane.registrationId,
		update.resourceId,
	]);

function inputFor(snapshot: WorkspaceViewSnapshot | null): WorkspaceViewInput {
	if (!snapshot)
		return emptyWorkspaceView({
			x: 0,
			y: 0,
			width: 1280,
			height: 850,
			maximized: false,
		});
	const {
		schemaVersion: _,
		revision: __,
		updatedAt: ___,
		...input
	} = structuredClone(snapshot);
	return input;
}

export function useWorkspaceViews(
	api: DirectWorkstationApi,
	connection: DirectDescriptor | null,
	callbacks: {
		onSkeleton(connectionId: string): void;
		onDescriptor(descriptor: DirectDescriptor): Promise<void>;
		onForget(): void;
		onError(message: string): void;
		getBrowserHomepage?(): { ready: boolean; url: string | null };
	},
) {
	const { t } = useLingui();
	const enabled =
		!!api.getWorkspaceView &&
		!!api.saveWorkspaceView &&
		!!api.beginWorkspaceRestore;
	const versioned = !!api.getWorkspaceViewV2 && !!api.saveWorkspaceViewV2;
	const browserEnabled =
		versioned &&
		!!api.browser?.updatePage &&
		!!api.browser.history &&
		!!api.browser.navigate;
	const readSnapshot = useCallback(async () => {
		const result = versioned
			? await api.getWorkspaceViewV2!()
			: await api.getWorkspaceView?.();
		return result
			? {
					...result,
					snapshot: result.snapshot
						? { ...result.snapshot, schemaVersion: 2 as const }
						: null,
				}
			: undefined;
	}, [api, versioned]);
	const saveSnapshot = useCallback(
		async (input: {
			expectedRevision: number;
			navigationRevision: number;
			view: WorkspaceViewInput;
			browserLeases?: { connectionId: string; generation: number }[];
		}): Promise<WorkspaceViewSnapshot> => {
			if (versioned) return api.saveWorkspaceViewV2!(input);
			if (hasBrowserPanes(input.view))
				throw new Error("Browser pages require V2 workspace storage");
			const saved = await api.saveWorkspaceView!({
				expectedRevision: input.expectedRevision,
				navigationRevision: input.navigationRevision,
				view: input.view as import("../../../../../shared/workspace-view").WorkspaceViewInput,
			});
			return { ...saved, schemaVersion: 2 };
		},
		[api, versioned],
	);
	const [view, setView] = useState<WorkspaceViewSnapshot | null>(null);
	const [invalid, setInvalid] = useState(false);
	const [restore, setRestore] = useState<WorkspaceRestoreSnapshot | null>(null);
	const [resources, setResources] = useState<RestoreResourceCheck[]>([]);
	const [resourceRevision, setResourceRevision] = useState(0);
	const [busy, setBusy] = useState(false);
	const pendingTerminalAction = useRef<Promise<void> | null>(null);
	const [navigationEpoch, setNavigationEpoch] = useState(0);
	const viewRef = useRef(view);
	viewRef.current = view;
	const connectionRef = useRef(connection);
	connectionRef.current = connection;
	const callbacksRef = useRef(callbacks);
	callbacksRef.current = callbacks;
	const navigation = useRef(0);
	const revision = useRef(0);
	const intent = useRef(0);
	const queue = useRef<Promise<unknown>>(Promise.resolve());
	const browserOpenIntent = useRef<number | null>(null);
	const job = useRef<WorkspaceRestoreSnapshot | null>(null);
	const restoredScope = useRef<string | null>(null);
	const mounted = useRef(false);
	const debounce = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
	const deferred = useRef<(() => Promise<unknown>) | null>(null);
	const labels = {
		terminal: t({ message: "Terminal" }),
		saveFailed: t({ message: "This window could not be saved." }),
	};
	const labelsRef = useRef(labels);
	labelsRef.current = labels;
	const setSaved = useCallback((saved: WorkspaceViewSnapshot | null) => {
		if (saved && viewRef.current && saved.revision < viewRef.current.revision)
			return;
		viewRef.current = saved;
		setView(saved);
	}, []);
	const read = useCallback(async () => {
		const captured = intent.current;
		const result = await readSnapshot();
		if (!result || !mounted.current) return result;
		revision.current = result.revision;
		setInvalid(result.invalid);
		if (captured === intent.current) setSaved(result.snapshot);
		return result;
	}, [readSnapshot, setSaved]);
	const receive = useCallback(
		(snapshot: WorkspaceRestoreSnapshot) => {
			if (
				!mounted.current ||
				snapshot.navigationRevision !== navigation.current
			)
				return;
			if (
				job.current?.jobId === snapshot.jobId &&
				job.current.sequence >= snapshot.sequence
			)
				return;
			job.current = snapshot;
			setRestore(snapshot);
			if (snapshot.status === "ready" && snapshot.descriptor) {
				const target = viewRef.current?.targets.find(
					(t) => t.connectionId === snapshot.descriptor!.connectionId,
				);
				if (target?.autoConnect === false)
					void read().catch(() =>
						callbacksRef.current.onError(labelsRef.current.saveFailed),
					);
				const workspace = target?.workspaces.find(
					(w) => w.tabId === target.activeTabId,
				);
				const refs =
					workspace?.panes
						.filter((p) => p.kind !== "browser")
						.map((p) => [
							workspace.workspaceId,
							p.kind,
							p.resourceId,
							p.executionId,
						]) ?? [];
				restoredScope.current = JSON.stringify([
					snapshot.descriptor.connectionId,
					snapshot.descriptor.generation,
					refs,
				]);
				setResources(snapshot.resources);
				setResourceRevision((n) => n + 1);
				void callbacksRef.current
					.onDescriptor(snapshot.descriptor)
					.catch((error) => {
						if (snapshot.navigationRevision === navigation.current)
							callbacksRef.current.onError(String(error));
					});
			}
		},
		[read],
	);
	const pendingPages = useRef(new Map<string, PageUpdate>());
	const pageTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
		undefined,
	);
	const pageDrain = useRef<Promise<void> | null>(null);
	const pageInFlight = useRef(new Set<string>());
	const drainBrowserPages = useCallback((): Promise<void> => {
		clearTimeout(pageTimer.current);
		if (pageDrain.current) return pageDrain.current;
		const drain = (async () => {
			while (pendingPages.current.size) {
				const updates = [...pendingPages.current.values()];
				pendingPages.current.clear();
				for (const update of updates) pageInFlight.current.add(pageKey(update));
				const captured = intent.current;
				const pending = queue.current.then(async () => {
					for (const update of updates) {
						if (!mounted.current) return;
						const result = await api.browser?.updatePage?.(update);
						if (result && result.status !== "stale") {
							revision.current = Math.max(
								revision.current,
								result.snapshot.revision,
							);
							if (mounted.current && captured === intent.current)
								setSaved(result.snapshot);
						}
					}
				});
				queue.current = pending.catch(() => {});
				try {
					await pending;
				} catch (error) {
					for (const update of updates) {
						const key = pageKey(update);
						if (!pendingPages.current.has(key))
							pendingPages.current.set(key, update);
					}
					throw error;
				} finally {
					for (const update of updates)
						pageInFlight.current.delete(pageKey(update));
				}
			}
		})();
		pageDrain.current = drain;
		const clear = () => {
			if (pageDrain.current === drain) pageDrain.current = null;
		};
		void drain.then(clear, clear);
		return drain;
	}, [api, setSaved]);
	const persistBrowserPage = useCallback(
		(update: PageUpdate) => {
			if (!browserEnabled || !mounted.current) return;
			const key = pageKey(update);
			if (
				pendingPages.current.size + pageInFlight.current.size >= 128 &&
				!pendingPages.current.has(key) &&
				!pageInFlight.current.has(key)
			) {
				callbacksRef.current.onError(labelsRef.current.saveFailed);
				return;
			}
			pendingPages.current.set(key, structuredClone(update));
			clearTimeout(pageTimer.current);
			pageTimer.current = setTimeout(
				() =>
					void drainBrowserPages().catch(() =>
						callbacksRef.current.onError(labelsRef.current.saveFailed),
					),
				200,
			);
		},
		[browserEnabled, drainBrowserPages],
	);
	const flush = useCallback(async () => {
		clearTimeout(debounce.current);
		const action = deferred.current;
		deferred.current = null;
		if (action) await action();
		await drainBrowserPages();
		await pendingTerminalAction.current;
		await queue.current;
	}, [drainBrowserPages]);
	const trackTerminalAction = useCallback((action: () => Promise<void>) => {
		if (pendingTerminalAction.current) return pendingTerminalAction.current;
		setBusy(true);
		const pending = action();
		pendingTerminalAction.current = pending;
		const clear = () => {
			if (pendingTerminalAction.current !== pending) return;
			pendingTerminalAction.current = null;
			if (mounted.current) setBusy(false);
		};
		void pending.then(clear, clear);
		return pending;
	}, []);

	useEffect(() => {
		mounted.current = true;
		if (!enabled)
			return () => {
				mounted.current = false;
			};
		const off = api.onWorkspaceRestore?.(receive);
		const offFlush = api.onWorkspaceViewFlush?.(flush);
		const initialNavigation = navigation.current;
		void read()
			.then(async (result) => {
				if (
					!result ||
					!mounted.current ||
					initialNavigation !== navigation.current
				)
					return;
				navigation.current = result.navigationRevision;
				const saved = result.snapshot;
				if (saved?.restoreOnLaunch && saved.activeConnectionId) {
					callbacksRef.current.onSkeleton(saved.activeConnectionId);
					const snapshot = await api.beginWorkspaceRestore!({
						reason: "launch",
						navigationRevision: navigation.current,
					});
					receive(snapshot);
				}
			})
			.catch(() => {
				if (mounted.current) setInvalid(true);
			});
		return () => {
			mounted.current = false;
			off?.();
			offFlush?.();
			clearTimeout(debounce.current);
			deferred.current = null;
			clearTimeout(pageTimer.current);
			pendingPages.current.clear();
		};
	}, [api, enabled, flush, read, receive]);
	const navigate = useCallback(() => {
		navigation.current++;
		setNavigationEpoch((n) => n + 1);
		restoredScope.current = null;
		setResources([]);
		intent.current++;
		clearTimeout(debounce.current);
		deferred.current = null;
		if (job.current)
			void api
				.cancelWorkspaceRestore?.({ restoreJobId: job.current.jobId })
				.catch(() => {});
		setRestore(null);
	}, [api]);
	const mutate = useCallback(
		(
			change: (input: WorkspaceViewInput) => void,
			optimistic = true,
		): Promise<WorkspaceViewSnapshot | null> => {
			if (!enabled) return Promise.resolve(null);
			const captured = navigation.current;
			const sequence = ++intent.current;
			if (optimistic && viewRef.current) {
				const updated = inputFor(viewRef.current);
				change(updated);
				setSaved({
					...updated,
					schemaVersion: 2,
					revision: viewRef.current.revision,
					updatedAt: viewRef.current.updatedAt,
				});
			}
			const pending = queue.current.then(async () => {
				for (let attempt = 0; attempt < 2; attempt++) {
					if (!mounted.current || captured !== navigation.current) return null;
					const current = await readSnapshot();
					if (!current) return null;
					if (!mounted.current || captured !== navigation.current) return null;
					const input = inputFor(current.snapshot);
					change(input);
					try {
						const descriptor = connectionRef.current;
						const saved = await saveSnapshot({
							expectedRevision: current.revision,
							navigationRevision: captured,
							view: input,
							...(descriptor
								? {
										browserLeases: [
											{
												connectionId: descriptor.connectionId,
												generation: descriptor.generation,
											},
										],
									}
								: {}),
						});
						revision.current = saved.revision;
						if (
							mounted.current &&
							captured === navigation.current &&
							sequence === intent.current
						)
							setSaved(saved);
						return saved;
					} catch (error) {
						if (attempt === 1) throw error;
					}
				}
				return null;
			});
			queue.current = pending.catch(() => {});
			return pending.catch(async () => {
				if (mounted.current && captured === navigation.current) {
					await read();
					callbacksRef.current.onError(labelsRef.current.saveFailed);
				}
				return null;
			});
		},
		[enabled, read, readSnapshot, saveSnapshot, setSaved],
	);
	const targetId = useCallback(
		() =>
			connectionRef.current?.connectionId ??
			viewRef.current?.activeConnectionId ??
			null,
		[],
	);
	const changeWorkspace = useCallback(
		(
			workspaceId: string,
			change: (
				workspace: WorkspaceViewInput["targets"][number]["workspaces"][number],
			) => void,
			optimistic = true,
		) => {
			const id = targetId();
			return mutate((input) => {
				const target = input.targets.find((t) => t.connectionId === id);
				const workspace = target?.workspaces.find(
					(w) => w.workspaceId === workspaceId,
				);
				if (workspace) change(workspace);
			}, optimistic);
		},
		[mutate, targetId],
	);
	const reloadForConnection = useRef<string | null>(null);
	useEffect(() => {
		if (!enabled || !connection) return;
		const key = `${connection.connectionId}:${connection.generation}`;
		if (reloadForConnection.current === key) return;
		reloadForConnection.current = key;
		void read();
	}, [enabled, connection, read]);
	const activeTarget = view?.targets.find(
		(target) => target.connectionId === connection?.connectionId,
	);
	const activeWorkspace = activeTarget?.workspaces.find(
		(w) => w.tabId === activeTarget.activeTabId,
	);
	const resourceKey = JSON.stringify(
		activeWorkspace?.panes
			.filter((p) => p.kind !== "browser")
			.map((p) => [
				activeWorkspace.workspaceId,
				p.kind,
				p.resourceId,
				p.executionId,
			]) ?? [],
	);
	const query = useRef(0);
	const refreshResources = useCallback(async () => {
		const descriptor = connectionRef.current;
		if (!descriptor?.capabilities?.workspaceViewRestoreV1) return;
		const target = viewRef.current?.targets.find(
			(t) => t.connectionId === descriptor.connectionId,
		);
		const workspace = target?.workspaces.find(
			(w) => w.tabId === target.activeTabId,
		);
		if (!workspace) return;
		const sequence = ++query.current;
		const captured = navigation.current;
		setResources([]);
		const refs = workspace.panes
			.filter((p) => p.kind !== "browser")
			.map((p) => ({
				workspaceId: workspace.workspaceId,
				kind: p.kind,
				resourceId: p.resourceId,
				...(p.executionId ? { executionId: p.executionId } : {}),
			}));
		try {
			const checked = await api.rpc<RestoreResourceCheck[]>({
				connectionId: descriptor.connectionId,
				generation: descriptor.generation,
				path: "workspace.restoreResources",
				type: "query",
				input: { refs },
			});
			if (
				mounted.current &&
				query.current === sequence &&
				captured === navigation.current &&
				connectionRef.current === descriptor
			) {
				setResources(checked);
				setResourceRevision((n) => n + 1);
			}
		} catch {
			if (
				mounted.current &&
				query.current === sequence &&
				captured === navigation.current
			)
				setResources(refs.map((r) => ({ ...r, state: "unknown" })));
		}
	}, [api]);
	// biome-ignore lint/correctness/useExhaustiveDependencies: Navigation invalidates pending resource checks even when IDs stay equal.
	useEffect(() => {
		if (!enabled) return;
		const scope = JSON.stringify([
			connection?.connectionId,
			connection?.generation,
			JSON.parse(resourceKey),
		]);
		if (restoredScope.current === scope) return;
		restoredScope.current = null;
		void refreshResources();
	}, [enabled, connection, resourceKey, refreshResources, navigationEpoch]);
	const openWorkspace = useCallback(
		async (
			workspace: RemoteWorkspace,
			initialTerminals: { terminalId: string; label?: string }[] = [],
		) => {
			const descriptor = connectionRef.current;
			if (!descriptor?.capabilities?.workspaceViewRestoreV1) return false;
			const id = descriptor.connectionId;
			const existing = viewRef.current?.targets
				.find((t) => t.connectionId === id)
				?.workspaces.find((w) => w.workspaceId === workspace.id);
			if (existing)
				return !!(await mutate((input) => {
					const target = input.targets.find((t) => t.connectionId === id);
					if (target) target.activeTabId = existing.tabId;
					input.activeConnectionId = id;
				}));
			const captured = navigation.current;
			const result = await api.rpc<{
				sessions: { terminalId: string; title?: string | null }[];
			}>({
				connectionId: id,
				generation: descriptor.generation,
				path: "terminal.list",
				type: "query",
				input: { workspaceId: workspace.id },
			});
			if (
				captured !== navigation.current ||
				descriptor !== connectionRef.current
			)
				return false;
			const panes: WorkspacePane[] = result.sessions
				.slice(0, 64)
				.map((session, index) => ({
					paneId: crypto.randomUUID(),
					kind: "terminal",
					resourceId: session.terminalId,
					label: (
						initialTerminals.find(
							(terminal) => terminal.terminalId === session.terminalId,
						)?.label ??
						session.title ??
						`${labelsRef.current.terminal} ${formatNumber(index + 1)}`
					).slice(0, 128),
				}));
			const tabId = crypto.randomUUID();
			return !!(await mutate((input) => {
				const target = input.targets.find((t) => t.connectionId === id);
				if (!target) {
					input.targets.push({
						connectionId: id,
						targetRevision: 1,
						backendId: descriptor.backendId,
						namespaceId: descriptor.namespaceId,
						serviceUid: 1,
						autoConnect: false,
						activeTabId: null,
						workspaces: [],
					});
				}
				const currentTarget =
					target ?? input.targets.find((t) => t.connectionId === id)!;
				const duplicate = currentTarget.workspaces.find(
					(w) => w.workspaceId === workspace.id,
				);
				if (duplicate) {
					currentTarget.activeTabId = duplicate.tabId;
					return;
				}
				currentTarget.workspaces.push({
					tabId,
					workspaceId: workspace.id,
					label: workspace.name.slice(0, 128),
					activeTool: "terminal",
					activePaneId: panes[0]?.paneId ?? null,
					panes,
					layout: buildPaneTree(panes.map((p) => p.paneId)),
				});
				currentTarget.activeTabId = tabId;
				input.activeConnectionId = id;
			}, false));
		},
		[api, mutate],
	);
	const addPane = useCallback(
		async (
			workspaceId: string,
			pane: WorkspacePane,
			axis: "horizontal" | "vertical",
			options?: {
				connection: DirectDescriptor;
				placement?: "active" | "root";
				newTab?: boolean;
				replaceResourceId?: string;
			},
		) => {
			const tabId = crypto.randomUUID(),
				createdAt = Date.now();
			return changeWorkspace(
				workspaceId,
				(workspace) => {
					if (
						options?.connection &&
						connectionRef.current !== options.connection
					)
						return;

					workspace.activeTool =
						pane.kind === "browser" ? "terminal" : pane.kind;
					const existing = workspace.panes.find(
						(p) =>
							p.kind === pane.kind &&
							(p.resourceId === pane.resourceId ||
								(!!options?.replaceResourceId &&
									p.resourceId === options.replaceResourceId)),
					);
					if (existing) {
						existing.resourceId = pane.resourceId;
						existing.executionId = pane.executionId;
						workspace.activePaneId = existing.paneId;
						if (workspace.paneTabs) {
							const before = toPaneState(workspace),
								store = createWorkspaceStore({ initialState: before });
							const found = store.getState().getPane(existing.paneId);
							if (found) {
								store.getState().setActivePane({
									tabId: found.tabId,
									paneId: existing.paneId,
								});
								applyWorkspacePaneState(workspace, store.getState(), before);
							}
						}
						return;
					}
					if (workspace.panes.length >= 64) return;

					if (options?.newTab || workspace.paneTabs) {
						const before = toPaneState(workspace),
							store = createWorkspaceStore({ initialState: before });
						const input = {
							id: pane.paneId,
							kind: pane.kind,
							titleOverride: pane.label,
							data: { ...pane },
						};
						const active = store.getState().getActiveTab();
						if (options?.newTab || !active)
							store.getState().insertTab({
								tab: {
									id: tabId,
									titleOverride: pane.label,
									createdAt,
									activePaneId: pane.paneId,
									layout: { type: "pane", paneId: pane.paneId },
									panes: { [pane.paneId]: input },
								},
							});
						else {
							store.getState().addPane({
								tabId: active.id,
								pane: input,
								position: axis === "horizontal" ? "right" : "bottom",
							});
							if (options?.placement === "root") {
								const next = store.getState();
								store.getState().replaceState({
									version: 1,
									activeTabId: next.activeTabId,
									tabs: next.tabs.map((t) =>
										t.id === active.id
											? {
													...t,
													layout: toPaneLayout(
														splitPane(
															fromPaneLayout(active.layout),
															null,
															pane.paneId,
															axis,
															0.65,
														),
													),
												}
											: t,
									),
								});
							}
						}
						workspace.panes.push(pane);
						applyWorkspacePaneState(workspace, store.getState(), before);
						return;
					}
					workspace.layout = splitPane(
						workspace.layout,
						options?.placement === "root"
							? null
							: (workspace.activePaneId ?? workspace.panes[0]?.paneId ?? null),
						pane.paneId,
						axis,
						options?.placement === "root" ? 0.65 : 0.5,
					);
					workspace.panes.push(pane);
					workspace.activePaneId = pane.paneId;
				},
				pane.kind !== "browser",
			);
		},
		[changeWorkspace],
	);
	const executeNewTerminal = useCallback(
		async (
			workspaceId: string,
			axis: "horizontal" | "vertical",
			launch?: { initialCommand: string; label: string },
			options?: { placement: "new-tab" },
		) => {
			const descriptor = connectionRef.current;
			if (
				!descriptor?.capabilities?.durableOperations ||
				!descriptor.capabilities.terminals ||
				(launch &&
					descriptor.capabilities.workstationTerminalPresetsV1 !== true)
			)
				return;
			if (
				(viewRef.current?.targets.flatMap((target) =>
					target.workspaces.flatMap((w) => w.panes),
				).length ?? 0) >= 64
			) {
				callbacksRef.current.onError(labelsRef.current.saveFailed);
				return;
			}
			const captured = navigation.current;
			const id = crypto.randomUUID();
			try {
				await api.rpc({
					connectionId: descriptor.connectionId,
					generation: descriptor.generation,
					path: "terminal.createSession",
					type: "mutation",
					input: {
						workspaceId,
						terminalId: id,
						operationId: crypto.randomUUID(),
						...(launch ? { initialCommand: launch.initialCommand } : {}),
					},
				});
				if (
					mounted.current &&
					captured === navigation.current &&
					descriptor === connectionRef.current
				)
					await addPane(
						workspaceId,
						{
							paneId: crypto.randomUUID(),
							kind: "terminal",
							resourceId: id,
							label: (launch?.label || labelsRef.current.terminal).slice(
								0,
								128,
							),
						},
						axis,
						options?.placement === "new-tab"
							? { connection: descriptor, newTab: true }
							: undefined,
					);
			} catch (error) {
				if (mounted.current && captured === navigation.current)
					callbacksRef.current.onError(String(error));
			}
		},
		[addPane, api],
	);
	const executeTerminalPreset = useCallback(
		async (
			workspaceId: string,
			preset: HostTerminalPreset,
			agents: HostAgentConfig[],
			options?: { target: "new-tab" },
		) => {
			const descriptor = connectionRef.current;
			if (
				!descriptor?.capabilities?.durableOperations ||
				!descriptor.capabilities.terminals ||
				descriptor.capabilities.workstationTerminalScriptExecutionV1 !== true
			)
				return false;
			const workspace = viewRef.current?.targets
				.find((t) => t.connectionId === descriptor.connectionId)
				?.workspaces.find((w) => w.workspaceId === workspaceId);
			if (!workspace) return false;
			const captured = navigation.current;
			const current = () =>
				mounted.current &&
				captured === navigation.current &&
				connectionRef.current === descriptor;
			const state = toPaneState(workspace),
				activeTabId = state.activeTabId;
			const activeTerminal = workspace.panes.find(
				(p) =>
					p.paneId === workspace.activePaneId &&
					p.kind === "terminal" &&
					p.executionId,
			);
			const commands = resolvePresetLaunchCommands(preset, agents);
			const launchCommands =
				preset.executionMode === "sequential"
					? [buildTerminalCommand(commands)].flatMap((command) =>
							command === null ? [] : [command],
						)
					: commands;
			const plan = getPresetLaunchPlan({
				mode: preset.executionMode,
				target:
					options?.target ??
					(preset.executionMode === "split-pane" ||
					preset.executionMode === "sequential"
						? "active-tab"
						: "new-tab"),
				commandCount: launchCommands.length,
				hasActiveTab: !!activeTabId,
				hasActiveTerminal: !!activeTerminal,
			});
			const count =
				plan === "active-terminal" ? 0 : Math.max(1, launchCommands.length);
			const existingCount =
				viewRef.current?.targets.flatMap((t) =>
					t.workspaces.flatMap((w) => w.panes),
				).length ?? 0;
			if (existingCount + count > 64) {
				callbacksRef.current.onError(labelsRef.current.saveFailed);
				return false;
			}
			try {
				const metadata = await api.rpc<{
					projectId: string;
					worktreePath: string;
				}>({
					connectionId: descriptor.connectionId,
					generation: descriptor.generation,
					path: "workspace.get",
					type: "query",
					input: { id: workspaceId },
				});
				if (!current() || !presetMatchesProjectId(preset, metadata.projectId))
					return false;
				const cwd = preset.cwd.trim()
					? toAbsoluteWorkspacePath(metadata.worktreePath, preset.cwd.trim())
					: undefined;
				if (plan === "active-terminal" && activeTerminal?.executionId) {
					const text = buildFocusedTerminalCommand({ commands, cwd });
					if (!text) return false;
					const [checked] = await api.rpc<RestoreResourceCheck[]>({
						connectionId: descriptor.connectionId,
						generation: descriptor.generation,
						path: "workspace.restoreResources",
						type: "query",
						input: {
							refs: [
								{
									workspaceId,
									kind: "terminal",
									resourceId: activeTerminal.resourceId,
									executionId: activeTerminal.executionId,
								},
							],
						},
					});
					if (!current()) return false;
					if (
						checked?.state !== "live" ||
						checked.executionId !== activeTerminal.executionId
					)
						throw new Error("The terminal execution is no longer current");
					await api.rpc({
						connectionId: descriptor.connectionId,
						generation: descriptor.generation,
						path: "terminal.runScriptV1",
						type: "mutation",
						input: {
							workspaceId,
							terminalId: activeTerminal.resourceId,
							executionId: activeTerminal.executionId,
							text,
							operationId: crypto.randomUUID(),
						},
					});
					if (current())
						await changeWorkspace(workspaceId, (w) => {
							const pane = w.panes.find(
								(p) =>
									p.paneId === activeTerminal.paneId &&
									p.resourceId === activeTerminal.resourceId &&
									p.executionId === activeTerminal.executionId,
							);
							if (
								pane &&
								shouldApplyPresetPaneName({
									currentName: pane.label,
									presetName: preset.name,
								})
							)
								pane.label = preset.name.slice(0, 128);
						});
					return current();
				}
				const launches = Array.from({ length: count }, (_, index) => ({
					command: launchCommands[index],
					terminalId: crypto.randomUUID(),
					paneId: crypto.randomUUID(),
					operationId: crypto.randomUUID(),
				}));
				const created: WorkspacePane[] = [];
				let failure: unknown;
				for (const launch of launches) {
					if (!current()) return false;
					try {
						await api.rpc({
							connectionId: descriptor.connectionId,
							generation: descriptor.generation,
							path: "terminal.createSession",
							type: "mutation",
							input: {
								workspaceId,
								terminalId: launch.terminalId,
								operationId: launch.operationId,
								...(launch.command === undefined
									? {}
									: { initialCommand: launch.command }),
								...(cwd ? { cwd } : {}),
							},
						});
						created.push({
							paneId: launch.paneId,
							kind: "terminal",
							resourceId: launch.terminalId,
							label: (preset.name || labelsRef.current.terminal).slice(0, 128),
						});
					} catch (error) {
						failure = error;
						break;
					}
				}
				if (!current()) return false;
				if (created.length) {
					const prepared = createWorkspaceStore<WorkspacePane>();
					const inputs = created.map((pane) => ({
						id: pane.paneId,
						kind: pane.kind,
						titleOverride: pane.label,
						data: { ...pane },
					}));
					if (plan === "new-tab-per-command")
						for (const pane of inputs)
							prepared.getState().addTab({
								id: crypto.randomUUID(),
								titleOverride: preset.name.slice(0, 128),
								panes: [pane],
							});
					else
						prepared.getState().addTab({
							id: crypto.randomUUID(),
							titleOverride: preset.name.slice(0, 128),
							panes: inputs as [(typeof inputs)[number], ...typeof inputs],
						});
					let rejected = false;
					const saved = await changeWorkspace(workspaceId, (w) => {
						const before = toPaneState(w),
							store = createWorkspaceStore({ initialState: before });
						if (
							plan === "active-tab-single" ||
							plan === "active-tab-multi-pane"
						) {
							if (!activeTabId || !store.getState().getTab(activeTabId)) {
								rejected = true;
								return false;
							}
							for (const pane of inputs)
								store
									.getState()
									.addPane({ tabId: activeTabId, pane, position: "right" });
						} else
							for (const tab of prepared.getState().tabs)
								store.getState().insertTab({ tab });
						const original = w.panes;
						w.panes = [...original, ...created];
						if (!applyWorkspacePaneState(w, store.getState(), before)) {
							w.panes = original;
							rejected = true;
						}
					});
					if (!saved) return false;
					if (rejected) {
						callbacksRef.current.onError(labelsRef.current.saveFailed);
						return false;
					}
				}
				if (failure) throw failure;
				return current();
			} catch (error) {
				if (current()) callbacksRef.current.onError(String(error));
				return false;
			}
		},
		[api, changeWorkspace],
	);
	const executePresetTrigger = useCallback(
		async (
			workspaceId: string,
			field: "applyOnNewTab" | "applyOnWorkspaceCreated",
		): Promise<"none" | "handled" | "cancelled"> => {
			const descriptor = connectionRef.current;
			if (
				!descriptor?.capabilities?.durableOperations ||
				!descriptor.capabilities.terminals ||
				descriptor.capabilities.workstationTerminalScriptsV1 !== true ||
				descriptor.capabilities.workstationTerminalScriptExecutionV1 !== true
			)
				return "none";
			const captured = navigation.current;
			const current = () =>
				mounted.current &&
				connectionRef.current === descriptor &&
				navigation.current === captured;
			const query = <T>(path: string, input?: unknown) =>
				api.rpc<T>({
					connectionId: descriptor.connectionId,
					generation: descriptor.generation,
					path,
					type: "query",
					...(input === undefined ? {} : { input }),
				});
			try {
				const metadata = await query<{ projectId: string | null }>(
					"workspace.get",
					{ id: workspaceId },
				);
				if (!current()) return "cancelled";
				const catalog = await query<HostTerminalPresetCatalog>(
					"settings.terminalPresets.catalogWithRevisionV1",
				);
				if (!current()) return "cancelled";
				const presets = getPresetsForTriggerField(
					catalog.presets,
					field,
					metadata.projectId,
				).sort((a, b) => a.tabOrder - b.tabOrder);
				if (!presets.length) return "none";
				let agents: HostAgentConfig[] = [];
				if (presets.some((p) => p.agentId)) {
					if (descriptor.capabilities.workstationAgentCatalogV2 !== true) {
						callbacksRef.current.onError(labelsRef.current.saveFailed);
						return "cancelled";
					}
					agents = (
						await query<{ configs: HostAgentConfig[] }>(
							"settings.agentConfigs.catalogWithRevisionV2",
						)
					).configs;
					if (!current()) return "cancelled";
				}
				for (const preset of presets) {
					if (!current()) return "cancelled";
					if (
						field === "applyOnWorkspaceCreated" &&
						!resolvePresetLaunchCommands(preset, agents).length
					)
						continue;
					if (
						!(await executeTerminalPreset(workspaceId, preset, agents, {
							target: "new-tab",
						}))
					)
						return "cancelled";
				}
				return "handled";
			} catch (error) {
				if (current()) callbacksRef.current.onError(String(error));
				return "cancelled";
			}
		},
		[api, executeTerminalPreset],
	);
	const newTerminal = useCallback(
		(...args: Parameters<typeof executeNewTerminal>) =>
			trackTerminalAction(async () => {
				const owner = connectionRef.current,
					captured = navigation.current;
				if (
					!args[2] &&
					args[3]?.placement === "new-tab" &&
					(await executePresetTrigger(args[0], "applyOnNewTab")) !== "none"
				)
					return;
				if (connectionRef.current !== owner || navigation.current !== captured)
					return;
				await executeNewTerminal(...args);
			}),
		[executeNewTerminal, executePresetTrigger, trackTerminalAction],
	);
	const runWorkspaceCreationPresets = useCallback(
		(workspaceId: string) =>
			trackTerminalAction(async () => {
				await executePresetTrigger(workspaceId, "applyOnWorkspaceCreated");
			}),
		[executePresetTrigger, trackTerminalAction],
	);

	const launchTerminalPreset = useCallback(
		(...args: Parameters<typeof executeTerminalPreset>) =>
			trackTerminalAction(async () => {
				await executeTerminalPreset(...args);
			}),
		[executeTerminalPreset, trackTerminalAction],
	);
	const saveLayout = useCallback(
		(
			workspaceId: string,
			layout: PaneTree,
			final: boolean,
			paneTabId?: string,
		) => {
			const patch = (
				w: WorkspaceViewInput["targets"][number]["workspaces"][number],
			) => {
				if (!w.paneTabs) {
					w.layout = layout;
					return true;
				}
				const before = toPaneState(w),
					next = structuredClone(before),
					tab = next.tabs.find((t) => t.id === (paneTabId ?? next.activeTabId));
				if (!tab) return false;
				tab.layout = toPaneLayout(layout);
				return applyWorkspacePaneState(w, next, before);
			};
			if (viewRef.current) {
				const optimistic = structuredClone(viewRef.current);
				const workspace = optimistic.targets
					.find((t) => t.connectionId === targetId())
					?.workspaces.find((w) => w.workspaceId === workspaceId);
				if (workspace && patch(workspace)) {
					setSaved(optimistic);
				}
			}
			clearTimeout(debounce.current);
			const action = async () => {
				let rejected = false;
				const result = await changeWorkspace(workspaceId, (w) => {
					if (!patch(w)) rejected = true;
				});
				if (rejected)
					callbacksRef.current.onError(labelsRef.current.saveFailed);
				return result;
			};
			if (final) {
				deferred.current = null;
				void action();
			} else {
				deferred.current = action;
				debounce.current = setTimeout(() => {
					deferred.current = null;
					void action();
				}, 250);
			}
		},
		[changeWorkspace, setSaved, targetId],
	);
	const savePaneState = useCallback(
		async (
			workspaceId: string,
			next: WorkspaceState<WorkspacePane>,
			before: WorkspaceState<WorkspacePane>,
		) => {
			const capturedNext = {
				version: 1 as const,
				activeTabId: next.activeTabId,
				tabs: structuredClone(next.tabs),
			};
			const capturedBefore = {
				version: 1 as const,
				activeTabId: before.activeTabId,
				tabs: structuredClone(before.tabs),
			};
			clearTimeout(debounce.current);
			deferred.current = null;
			let rejected = false;
			const result = await changeWorkspace(workspaceId, (w) => {
				if (!applyWorkspacePaneState(w, capturedNext, capturedBefore))
					rejected = true;
			});
			if (rejected) {
				callbacksRef.current.onError(labelsRef.current.saveFailed);
				return null;
			}
			return result;
		},
		[changeWorkspace],
	);
	const restoreManual = useCallback(async () => {
		navigate();
		const target = viewRef.current?.activeConnectionId;
		if (!target || !api.beginWorkspaceRestore) return;
		callbacksRef.current.onSkeleton(target);
		try {
			receive(
				await api.beginWorkspaceRestore({
					reason: "manual",
					navigationRevision: navigation.current,
				}),
			);
		} catch {
			callbacksRef.current.onError(labelsRef.current.saveFailed);
		}
	}, [api, navigate, receive]);
	const forget = useCallback(async () => {
		navigate();
		try {
			const current = await api.getWorkspaceView?.();
			if (!current) return;
			await api.forgetWorkspaceView?.({ expectedRevision: current.revision });
			setSaved(null);
			setResources([]);
			setInvalid(false);
			callbacksRef.current.onForget();
		} catch {
			callbacksRef.current.onError(labelsRef.current.saveFailed);
		}
	}, [api, navigate, setSaved]);
	return {
		enabled,
		browserEnabled,
		persistBrowserPage,
		enqueueBrowserOpen: <T>(action: () => Promise<T>): Promise<T> => {
			const pending = queue.current.then(async () => {
				browserOpenIntent.current = intent.current;
				try {
					return await action();
				} finally {
					browserOpenIntent.current = null;
				}
			});
			queue.current = pending.catch(() => {});
			return pending;
		},
		acceptBrowserOpen: (
			saved: WorkspaceViewSnapshot,
			connectionId: string,
			workspaceId: string,
			show: boolean,
		) => {
			revision.current = Math.max(revision.current, saved.revision);
			setSaved(
				preserveBrowserOpenSelection(
					viewRef.current,
					saved,
					connectionId,
					workspaceId,
					show,
					browserOpenIntent.current !== null &&
						browserOpenIntent.current !== intent.current,
				),
			);
		},
		newBrowser: async (
			workspaceId: string,
			url?: string,
			placement: "split" | "new-tab" = "new-tab",
			source?: DirectDescriptor,
		) => {
			const descriptor = connectionRef.current;
			if (!browserEnabled || !descriptor?.capabilities?.workspaceViewRestoreV1)
				return null;
			if (
				source &&
				(source.connectionId !== descriptor.connectionId ||
					source.generation !== descriptor.generation ||
					source.backendId !== descriptor.backendId ||
					source.namespaceId !== descriptor.namespaceId ||
					source.instanceId !== descriptor.instanceId)
			)
				return null;
			const homepage =
				url === undefined
					? callbacksRef.current.getBrowserHomepage?.()
					: undefined;
			if (homepage && !homepage.ready) {
				callbacksRef.current.onError(labelsRef.current.saveFailed);
				return null;
			}
			const initialUrl = sanitizeUrl(url ?? homepage?.url ?? "about:blank");
			const paneId = crypto.randomUUID();
			return addPane(
				workspaceId,
				{
					paneId,
					resourceId: crypto.randomUUID(),
					kind: "browser",
					browser: { url: initialUrl, pageTitle: "", faviconUrl: null },
				},
				"horizontal",
				{ connection: descriptor, newTab: placement === "new-tab" },
			);
		},
		closeBrowserPane: (
			connectionId: string,
			workspaceId: string,
			paneId: string,
			resourceId: string,
		) =>
			mutate((input) => {
				const workspace = input.targets
					.find((t) => t.connectionId === connectionId)
					?.workspaces.find((w) => w.workspaceId === workspaceId);
				const pane = workspace?.panes.find(
					(p) =>
						p.kind === "browser" &&
						p.paneId === paneId &&
						p.resourceId === resourceId,
				);
				if (!workspace || !pane) return;
				if (workspace.paneTabs) {
					const before = toPaneState(workspace),
						store = createWorkspaceStore({ initialState: before }),
						found = store.getState().getPane(paneId);
					if (found) {
						store
							.getState()
							.closePane({ tabId: found.tabId, paneId, intent: "remove" });
						applyWorkspacePaneState(workspace, store.getState(), before);
					}
				} else {
					workspace.panes = workspace.panes.filter((p) => p.paneId !== paneId);
					workspace.layout = removePane(workspace.layout, paneId);
					if (workspace.activePaneId === paneId)
						workspace.activePaneId = workspace.panes[0]?.paneId ?? null;
				}
			}),
		view,
		invalid,
		restore,
		resources,
		resourceRevision,
		busy,
		read,
		flush,
		navigate,
		openWorkspace,
		addPane,
		newTerminal,
		launchTerminalPreset,
		runWorkspaceCreationPresets,
		saveLayout,
		savePaneState,
		restoreManual,
		forget,
		refreshResources,
		setRestoreOnLaunch: (enabled: boolean) => {
			navigate();
			return mutate((v) => {
				v.restoreOnLaunch = enabled;
			});
		},
		focusPane: (workspaceId: string, paneId: string) =>
			changeWorkspace(workspaceId, (w) => {
				if (w.paneTabs) {
					const before = toPaneState(w),
						store = createWorkspaceStore({ initialState: before }),
						found = store.getState().getPane(paneId);
					if (found) {
						store.getState().setActivePane({ tabId: found.tabId, paneId });
						applyWorkspacePaneState(w, store.getState(), before);
					}
					return;
				}
				w.activePaneId = paneId;
			}),
		renamePane: (workspaceId: string, paneId: string, label: string) =>
			changeWorkspace(workspaceId, (w) => {
				const p = w.panes.find((p) => p.paneId === paneId);
				if (p) p.label = label.slice(0, 128);
			}),
		selectChat: (workspaceId: string, paneId: string, resourceId: string) =>
			changeWorkspace(workspaceId, (w) => {
				const existing = w.panes.find(
					(p) => p.kind === "chat" && p.resourceId === resourceId,
				);
				if (existing) {
					if (w.paneTabs) {
						const before = toPaneState(w),
							store = createWorkspaceStore({ initialState: before }),
							found = store.getState().getPane(existing.paneId);
						if (found) {
							store
								.getState()
								.setActivePane({ tabId: found.tabId, paneId: existing.paneId });
							applyWorkspacePaneState(w, store.getState(), before);
						}
					} else w.activePaneId = existing.paneId;
					return;
				}
				const p = w.panes.find((p) => p.paneId === paneId);
				if (p) p.resourceId = resourceId;
			}),
		closePane: (workspaceId: string, paneId: string) =>
			changeWorkspace(workspaceId, (w) => {
				if (w.paneTabs) {
					const before = toPaneState(w),
						store = createWorkspaceStore({ initialState: before }),
						found = store.getState().getPane(paneId);
					if (found) {
						store
							.getState()
							.closePane({ tabId: found.tabId, paneId, intent: "remove" });
						applyWorkspacePaneState(w, store.getState(), before);
					}
					return;
				}
				w.panes = w.panes.filter((p) => p.paneId !== paneId);
				w.layout = removePane(w.layout, paneId);
				if (w.activePaneId === paneId)
					w.activePaneId = w.panes[0]?.paneId ?? null;
			}),
		setTool: (workspaceId: string, tool: "terminal" | "chat" | "files") =>
			changeWorkspace(workspaceId, (w) => {
				w.activeTool = tool;
			}),
		selectTab: (id: string | null) => {
			const connectionId = targetId();
			return mutate((v) => {
				const target = v.targets.find((t) => t.connectionId === connectionId);
				if (target) target.activeTabId = id;
			});
		},
		renameTab: (id: string, label: string | undefined) => {
			const connectionId = targetId();
			return mutate((v) => {
				const workspace = v.targets
					.find((t) => t.connectionId === connectionId)
					?.workspaces.find((w) => w.tabId === id);
				if (workspace) workspace.label = label?.slice(0, 128);
			});
		},
		reorderTab: (id: string, toIndex: number) => {
			const connectionId = targetId();
			return mutate((v) => {
				const target = v.targets.find((t) => t.connectionId === connectionId);
				if (!target) return;
				const index = target.workspaces.findIndex((w) => w.tabId === id);
				if (index < 0) return;
				const [workspace] = target.workspaces.splice(index, 1);
				if (workspace)
					target.workspaces.splice(
						Math.max(0, Math.min(toIndex, target.workspaces.length)),
						0,
						workspace,
					);
			});
		},
		removeWorkspace: (owner: DirectDescriptor, workspaceId: string) =>
			mutate((v) => {
				const target = v.targets.find(
					(t) =>
						t.connectionId === owner.connectionId &&
						t.backendId === owner.backendId &&
						t.namespaceId === owner.namespaceId,
				);
				if (!target) return;
				target.workspaces = target.workspaces.filter(
					(w) => w.workspaceId !== workspaceId,
				);
				if (!target.workspaces.some((w) => w.tabId === target.activeTabId))
					target.activeTabId = target.workspaces[0]?.tabId ?? null;
			}),

		closeTab: (id: string) => {
			const connectionId = targetId();
			return mutate((v) => {
				const target = v.targets.find((t) => t.connectionId === connectionId);
				if (!target) return;
				target.workspaces = target.workspaces.filter((w) => w.tabId !== id);
				if (target.activeTabId === id)
					target.activeTabId = target.workspaces[0]?.tabId ?? null;
			});
		},
	};
}
export type WorkspaceViewActions = ReturnType<typeof useWorkspaceViews>;

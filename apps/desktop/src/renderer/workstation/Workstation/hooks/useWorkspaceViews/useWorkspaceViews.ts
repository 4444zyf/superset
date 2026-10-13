import { useCallback, useEffect, useRef, useState } from "react";
import { useLingui } from "@lingui/react/macro";
import { formatNumber } from "@superset/i18n/format";
import type { RestoreResourceCheck } from "@superset/shared/workspace-restore";
import type {
	DirectDescriptor,
	DirectWorkstationApi,
} from "../../../../../shared/direct-workstation";
import {
	emptyWorkspaceView,
	type PaneTree,
	type WorkspacePane,
	type WorkspaceViewInput,
	type WorkspaceViewSnapshot,
	type WorkspaceRestoreSnapshot,
} from "../../../../../shared/workspace-view";
import type { RemoteWorkspace } from "../../types";
import {
	buildPaneTree,
	removePane,
	splitPane,
} from "../../utils/pane-layout/pane-layout";

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
	},
) {
	const { t } = useLingui();
	const enabled =
		!!api.getWorkspaceView &&
		!!api.saveWorkspaceView &&
		!!api.beginWorkspaceRestore;
	const [view, setView] = useState<WorkspaceViewSnapshot | null>(null);
	const [invalid, setInvalid] = useState(false);
	const [restore, setRestore] = useState<WorkspaceRestoreSnapshot | null>(null);
	const [resources, setResources] = useState<RestoreResourceCheck[]>([]);
	const [resourceRevision, setResourceRevision] = useState(0);
	const [busy, setBusy] = useState(false);
	const operationBusy = useRef(false);
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
		viewRef.current = saved;
		setView(saved);
	}, []);
	const read = useCallback(async () => {
		const captured = intent.current;
		const result = await api.getWorkspaceView?.();
		if (!result || !mounted.current) return result;
		revision.current = result.revision;
		setInvalid(result.invalid);
		if (captured === intent.current) setSaved(result.snapshot);
		return result;
	}, [api, setSaved]);
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
					workspace?.panes.map((p) => [
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
	const flush = useCallback(async () => {
		clearTimeout(debounce.current);
		const action = deferred.current;
		deferred.current = null;
		if (action) await action();
		await queue.current;
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
					schemaVersion: 1,
					revision: viewRef.current.revision,
					updatedAt: viewRef.current.updatedAt,
				});
			}
			const pending = queue.current.then(async () => {
				for (let attempt = 0; attempt < 2; attempt++) {
					if (!mounted.current || captured !== navigation.current) return null;
					const current = await api.getWorkspaceView!();
					if (!mounted.current || captured !== navigation.current) return null;
					const input = inputFor(current.snapshot);
					change(input);
					try {
						const saved = await api.saveWorkspaceView!({
							expectedRevision: current.revision,
							navigationRevision: captured,
							view: input,
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
		[api, enabled, read, setSaved],
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
		) => {
			const id = targetId();
			return mutate((input) => {
				const target = input.targets.find((t) => t.connectionId === id);
				const workspace = target?.workspaces.find(
					(w) => w.workspaceId === workspaceId,
				);
				if (workspace) change(workspace);
			});
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
		activeWorkspace?.panes.map((p) => [
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
		const refs = workspace.panes.map((p) => ({
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
	useEffect(() => {
		if (
			enabled &&
			restoredScope.current !==
				JSON.stringify([
					connection?.connectionId,
					connection?.generation,
					JSON.parse(resourceKey),
				])
		)
			void refreshResources();
	}, [enabled, connection, resourceKey, refreshResources, navigationEpoch]);
	const openWorkspace = useCallback(
		async (workspace: RemoteWorkspace) => {
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
		) =>
			changeWorkspace(workspaceId, (workspace) => {
				const existing = workspace.panes.find(
					(p) => p.kind === pane.kind && p.resourceId === pane.resourceId,
				);
				if (existing) {
					workspace.activePaneId = existing.paneId;
					return;
				}
				workspace.layout = splitPane(
					workspace.layout,
					workspace.activePaneId ?? workspace.panes[0]?.paneId ?? null,
					pane.paneId,
					axis,
				);
				workspace.panes.push(pane);
				workspace.activePaneId = pane.paneId;
			}),
		[changeWorkspace],
	);
	const newTerminal = useCallback(
		async (workspaceId: string, axis: "horizontal" | "vertical") => {
			const descriptor = connectionRef.current;
			if (
				!descriptor?.capabilities?.durableOperations ||
				!descriptor.capabilities.terminals ||
				operationBusy.current
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
			operationBusy.current = true;
			setBusy(true);
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
							label: labelsRef.current.terminal,
						},
						axis,
					);
			} catch (error) {
				if (mounted.current && captured === navigation.current)
					callbacksRef.current.onError(String(error));
			} finally {
				operationBusy.current = false;
				if (mounted.current) setBusy(false);
			}
		},
		[addPane, api, busy],
	);
	const saveLayout = useCallback(
		(workspaceId: string, layout: PaneTree, final: boolean) => {
			if (viewRef.current) {
				const optimistic = structuredClone(viewRef.current);
				const workspace = optimistic.targets
					.find((t) => t.connectionId === targetId())
					?.workspaces.find((w) => w.workspaceId === workspaceId);
				if (workspace) {
					workspace.layout = layout;
					setSaved(optimistic);
				}
			}
			clearTimeout(debounce.current);
			const action = () =>
				changeWorkspace(workspaceId, (w) => {
					w.layout = layout;
				});
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
		view,
		invalid,
		restore,
		resources,
		resourceRevision,
		busy,
		read,
		navigate,
		openWorkspace,
		addPane,
		newTerminal,
		saveLayout,
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
					w.activePaneId = existing.paneId;
					return;
				}
				const p = w.panes.find((p) => p.paneId === paneId);
				if (p) p.resourceId = resourceId;
			}),
		closePane: (workspaceId: string, paneId: string) =>
			changeWorkspace(workspaceId, (w) => {
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

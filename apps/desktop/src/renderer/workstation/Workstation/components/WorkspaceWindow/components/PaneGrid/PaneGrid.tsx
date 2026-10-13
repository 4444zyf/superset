import { Trans } from "@lingui/react/macro";
import type { RestoreResourceCheck } from "@superset/shared/workspace-restore";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type {
	DirectDescriptor,
	DirectWorkstationApi,
} from "../../../../../../../shared/direct-workstation";
import type { WorkspaceView } from "../../../../../../../shared/workspace-view";
import type { WorkspaceViewActions } from "../../../../hooks/useWorkspaceViews/useWorkspaceViews";
import { updateRatio } from "../../../../utils/pane-layout/pane-layout";
import type { TerminalEmulator } from "../../../RemoteTerminal/RemoteTerminal";
import { PaneTreeView } from "../PaneTreeView/PaneTreeView";
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
				active={workspace.activePaneId === id}
				allowed={allowed.has(id)}
				createEmulator={createEmulator}
				onFocus={() => {
					void actions.focusPane(workspace.workspaceId, id);
				}}
				onClose={() => {
					void actions.closePane(workspace.workspaceId, id);
				}}
				onRename={(label) => {
					void actions.renamePane(workspace.workspaceId, id, label);
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
	return (
		<div className="ws-pane-grid">
			{compact && (
				<nav className="ws-compact-panes">
					{workspace.panes.map((p) => (
						<button
							type="button"
							key={p.paneId}
							className={workspace.activePaneId === p.paneId ? "active" : ""}
							onClick={() => {
								void actions.focusPane(workspace.workspaceId, p.paneId);
							}}
						>
							{p.label ?? <Trans>Terminal</Trans>}
						</button>
					))}
				</nav>
			)}
			<div className="ws-pane-layout">
				{workspace.layout && !compact ? (
					<PaneTreeView
						tree={workspace.layout}
						renderPane={renderPane}
						onRatio={(path, ratio, final) => {
							const next = updateRatio(workspace.layout, path, ratio);
							if (next) actions.saveLayout(workspace.workspaceId, next, final);
						}}
					/>
				) : (
					visible.map((pane) => renderPane(pane.paneId))
				)}
			</div>
		</div>
	);
}

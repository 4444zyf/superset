import { Trans, useLingui } from "@lingui/react/macro";
import { createWorkspaceStore, WorkspaceTabBar } from "@superset/panes";
import type { RestoreResourceCheck } from "@superset/shared/workspace-restore";
import { Button } from "@superset/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@superset/ui/dropdown-menu";
import { Columns2, Folder, Rows2 } from "lucide-react";
import { useLayoutEffect, useMemo, useState } from "react";
import type {
	DirectDescriptor,
	DirectWorkstationApi,
} from "../../../../../shared/direct-workstation";
import type {
	TargetView,
	WorkspacePane,
	WorkspaceRestoreSnapshot,
} from "../../../../../shared/workspace-view";
import type { WorkspaceViewActions } from "../../hooks/useWorkspaceViews/useWorkspaceViews";
import { RemoteChat } from "../RemoteChat/RemoteChat";
import { RemoteWorkspaceRun } from "../RemoteWorkspaceRun";
import { RemoteFiles } from "../RemoteFiles/RemoteFiles";
import { WorkspacePortControls } from "../WorkspacePortControls";
import { WorkstationDialog } from "../WorkstationDialog/WorkstationDialog";
import { PaneGrid } from "./components/PaneGrid/PaneGrid";

export function WorkspaceWindow({
	api,
	target,
	connection,
	checks,
	resourceRevision,
	restore,
	actions,
	onBrowse,
	onMachines,
	onError,
	onNewSession,
	onRefresh,
	onPending,
	onProjectSettings,
	ports,
}: {
	api: DirectWorkstationApi;
	target: TargetView;
	connection: DirectDescriptor | null;
	checks: RestoreResourceCheck[];
	resourceRevision: number;
	restore: WorkspaceRestoreSnapshot | null;
	actions: WorkspaceViewActions;
	onNewSession(): void;
	onRefresh(): void;
	onPending(): void;
	onProjectSettings(projectId: string): void;
	ports: {
		busy: boolean;
		forward: { id: string; url: string } | null;
		onOpen(workspaceId: string, port: number): void;
		onClose(): void;
	};
	onBrowse(): void;
	onMachines(): void;
	onError(message: string): void;
}) {
	const { t } = useLingui();
	useLayoutEffect(() => {
		if (!performance.getEntriesByName("workspace-layout-visible").length)
			performance.mark("workspace-layout-visible");
	}, []);
	const tabScope = useMemo(
		() => ({
			connectionId: target.connectionId,
			store: createWorkspaceStore<WorkspacePane>(),
		}),
		[target.connectionId],
	);
	const tabStore = tabScope.store;
	const tabs = useMemo(
		() =>
			target.workspaces.map((w) => ({
				id: w.tabId,
				titleOverride: w.label ?? w.workspaceId,
				createdAt: 0,
				activePaneId: w.activePaneId,
				layout: { type: "pane" as const, paneId: w.activePaneId ?? "empty" },
				panes: {},
			})),
		[target.workspaces],
	);
	useLayoutEffect(
		() =>
			tabStore
				.getState()
				.replaceState({ version: 1, tabs, activeTabId: target.activeTabId }),
		[tabStore, tabs, target.activeTabId],
	);
	const [chatPicker, setChatPicker] = useState(false);
	const workspace = target.workspaces.find(
		(w) => w.tabId === target.activeTabId,
	);
	const restoring =
		restore?.status === "connecting" || restore?.status === "checking";
	return (
		<div className="ws-workspace-window">
			<div className="ws-window-toolbar">
				<Button type="button" variant="ghost" size="sm" onClick={onBrowse}>
					<Trans>Workspaces</Trans>
				</Button>
				<Button type="button" variant="ghost" size="sm" onClick={onMachines}>
					<Trans>SSH machines</Trans>
				</Button>
			</div>
			<div className="ws-workspace-tabs">
				<WorkspaceTabBar
					store={tabStore}
					tabs={tabs}
					registry={{}}
					activeTabId={target.activeTabId}
					canDropItem={(item) => item.store === tabStore && !!item.tabId}
					onSelectTab={(id) => {
						void actions.selectTab(id);
					}}
					onCloseTab={(id) => {
						void actions.closeTab(id);
					}}
					onCloseOtherTabs={(id) => {
						for (const w of target.workspaces)
							if (w.tabId !== id) void actions.closeTab(w.tabId);
					}}
					onCloseAllTabs={() => {
						for (const w of target.workspaces) void actions.closeTab(w.tabId);
					}}
					onRenameTab={(id, label) => {
						void actions.renameTab(id, label);
					}}
					onReorderTab={(id, index) => {
						void actions.reorderTab(id, index);
					}}
					onMovePaneToNewTab={() => {}}
					renderTabIcon={() => <Folder size={14} />}
					renderAddTabMenu={() => (
						<>
							<DropdownMenuItem
								disabled={
									!connection?.capabilities?.sessions ||
									!connection.capabilities.durableOperations
								}
								onSelect={onNewSession}
							>
								<Trans>New session</Trans>
							</DropdownMenuItem>
							<DropdownMenuItem onSelect={onBrowse}>
								<Trans>Workspaces</Trans>
							</DropdownMenuItem>
						</>
					)}
				/>
			</div>
			{(!connection || restore?.status === "paused") && (
				<output className="ws-notice" aria-live="polite">
					{restoring ? (
						<Trans>Reconnecting</Trans>
					) : (
						<Trans>Reconnect manually</Trans>
					)}{" "}
					<Button
						type="button"
						variant="ghost"
						size="sm"
						disabled={restoring}
						onClick={() => {
							void actions.restoreManual();
						}}
					>
						<Trans>Retry</Trans>
					</Button>
				</output>
			)}
			{workspace && (
				<>
					<div className="ws-window-toolbar">
						{connection?.capabilities?.workstationWorkspaceRunV1 && (
							<RemoteWorkspaceRun
								key={`${connection.connectionId}:${connection.generation}:${workspace.workspaceId}`}
								api={api}
								connection={connection}
								workspaceId={workspace.workspaceId}
								canStart={workspace.panes.length < 64}
								onConfigure={onProjectSettings}
								onAttach={async (run) => {
									if (
										workspace.panes.some(
											(p) =>
												p.kind === "terminal" &&
												p.resourceId === run.terminalId,
										)
									)
										return;
									await actions.addPane(
										workspace.workspaceId,
										{
											paneId: crypto.randomUUID(),
											kind: "terminal",
											resourceId: run.terminalId,
											executionId: run.executionId,
											label: t({ message: "Run" }),
										},
										"horizontal",
										connection,
									);
								}}
							/>
						)}

						<Button
							type="button"
							variant="ghost"
							size="sm"
							disabled={
								!connection?.capabilities?.durableOperations || actions.busy
							}
							onClick={() => {
								void actions.newTerminal(workspace.workspaceId, "horizontal");
							}}
						>
							<Trans>New terminal</Trans>
						</Button>
						<Button
							type="button"
							variant="ghost"
							size="sm"
							aria-label={t({ message: "Split horizontally" })}
							disabled={
								!connection?.capabilities?.durableOperations || actions.busy
							}
							onClick={() => {
								void actions.newTerminal(workspace.workspaceId, "horizontal");
							}}
						>
							<Columns2 size={14} />
							<Trans>Split horizontally</Trans>
						</Button>
						<Button
							type="button"
							variant="ghost"
							size="sm"
							aria-label={t({ message: "Split vertically" })}
							disabled={
								!connection?.capabilities?.durableOperations || actions.busy
							}
							onClick={() => {
								void actions.newTerminal(workspace.workspaceId, "vertical");
							}}
						>
							<Rows2 size={14} />
							<Trans>Split vertically</Trans>
						</Button>
						{connection?.capabilities?.chat && (
							<Button
								type="button"
								variant="ghost"
								size="sm"
								onClick={() => setChatPicker(true)}
							>
								<Trans>Chat</Trans>
							</Button>
						)}
						{connection && (
							<>
								<DropdownMenu>
									<DropdownMenuTrigger asChild>
										<Button variant="ghost" size="sm">
											<Trans>Port</Trans>
										</Button>
									</DropdownMenuTrigger>
									<DropdownMenuContent className="p-3" align="end">
										<WorkspacePortControls
											busy={ports.busy}
											forward={ports.forward}
											onOpenPort={(port) =>
												ports.onOpen(workspace.workspaceId, port)
											}
											onClosePort={ports.onClose}
										/>
									</DropdownMenuContent>
								</DropdownMenu>
								<Button
									variant="ghost"
									size="sm"
									disabled={ports.busy}
									onClick={onRefresh}
								>
									<Trans>Refresh</Trans>
								</Button>
								<Button
									variant="ghost"
									size="sm"
									disabled={ports.busy}
									onClick={onPending}
								>
									<Trans>Check pending action</Trans>
								</Button>
							</>
						)}
						{connection?.capabilities?.files && (
							<Button
								type="button"
								variant="ghost"
								size="sm"
								onClick={() => {
									void actions.setTool(
										workspace.workspaceId,
										workspace.activeTool === "files" ? "terminal" : "files",
									);
								}}
							>
								{workspace.activeTool === "files" ? (
									<Trans>Terminal</Trans>
								) : (
									<Trans>Files</Trans>
								)}
							</Button>
						)}
					</div>
					{workspace.activeTool === "files" && connection ? (
						<RemoteFiles
							api={api}
							connection={connection}
							workspaceId={workspace.workspaceId}
							onError={onError}
						/>
					) : (
						<PaneGrid
							key={`${connection?.generation ?? "offline"}:${workspace.tabId}:${resourceRevision}`}
							api={api}
							connection={connection}
							workspace={workspace}
							checks={checks}
							actions={actions}
						/>
					)}
					{chatPicker && (
						<WorkstationDialog
							title={t({ message: "Chat" })}
							onClose={() => setChatPicker(false)}
						>
							{connection && (
								<RemoteChat
									api={api}
									connection={connection}
									workspaceId={workspace.workspaceId}
									selectedSessionId={null}
									onSessionSelected={(id) => {
										if (!id) return;
										void actions
											.addPane(
												workspace.workspaceId,
												{
													paneId: crypto.randomUUID(),
													kind: "chat",
													resourceId: id,
													label: t({ message: "Chat" }),
												},
												"horizontal",
											)
											.then(() => setChatPicker(false));
									}}
									onError={onError}
								/>
							)}
						</WorkstationDialog>
					)}
				</>
			)}
		</div>
	);
}

import { Trans, useLingui } from "@lingui/react/macro";
import type { RestoreResourceCheck } from "@superset/shared/workspace-restore";
import { Columns2, Rows2, X } from "lucide-react";
import { useLayoutEffect, useState } from "react";
import type {
	DirectDescriptor,
	DirectWorkstationApi,
} from "../../../../../shared/direct-workstation";
import type {
	TargetView,
	WorkspaceRestoreSnapshot,
} from "../../../../../shared/workspace-view";
import type { WorkspaceViewActions } from "../../hooks/useWorkspaceViews/useWorkspaceViews";
import { RemoteChat } from "../RemoteChat/RemoteChat";
import { RemoteFiles } from "../RemoteFiles/RemoteFiles";
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
}: {
	api: DirectWorkstationApi;
	target: TargetView;
	connection: DirectDescriptor | null;
	checks: RestoreResourceCheck[];
	resourceRevision: number;
	restore: WorkspaceRestoreSnapshot | null;
	actions: WorkspaceViewActions;
	onBrowse(): void;
	onMachines(): void;
	onError(message: string): void;
}) {
	const { t } = useLingui();
	useLayoutEffect(() => {
		if (!performance.getEntriesByName("workspace-layout-visible").length)
			performance.mark("workspace-layout-visible");
	}, []);
	const [chatPicker, setChatPicker] = useState(false);
	const workspace = target.workspaces.find(
		(w) => w.tabId === target.activeTabId,
	);
	return (
		<div className="ws-workspace-window">
			<div className="ws-window-toolbar">
				<button type="button" className="ws-link" onClick={onBrowse}>
					<Trans>Workspaces</Trans>
				</button>
				<button type="button" className="ws-button small" onClick={onMachines}>
					<Trans>SSH machines</Trans>
				</button>
			</div>
			<nav className="ws-workspace-tabs" role="tablist">
				{target.workspaces.map((w) => (
					<div
						key={w.tabId}
						className={w.tabId === target.activeTabId ? "active" : ""}
					>
						<button
							type="button"
							role="tab"
							aria-selected={w.tabId === target.activeTabId}
							onClick={() => {
								void actions.selectTab(w.tabId);
							}}
						>
							{w.label ?? w.workspaceId}
						</button>
						<button
							type="button"
							aria-label={t({ message: "Close tab" })}
							onClick={() => {
								void actions.closeTab(w.tabId);
							}}
						>
							<X size={12} />
						</button>
					</div>
				))}
			</nav>
			{(!connection || restore?.status === "paused") && (
				<output className="ws-notice" aria-live="polite">
					<Trans>Reconnect manually</Trans>{" "}
					<button
						type="button"
						className="ws-button small"
						onClick={() => {
							void actions.restoreManual();
						}}
					>
						<Trans>Retry</Trans>
					</button>
				</output>
			)}
			{workspace && (
				<>
					<div className="ws-window-toolbar">
						<button
							type="button"
							className="ws-button small"
							disabled={
								!connection?.capabilities?.durableOperations || actions.busy
							}
							onClick={() => {
								void actions.newTerminal(workspace.workspaceId, "horizontal");
							}}
						>
							<Trans>New terminal</Trans>
						</button>
						<button
							type="button"
							className="ws-button small"
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
						</button>
						<button
							type="button"
							className="ws-button small"
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
						</button>
						{connection?.capabilities?.chat && (
							<button
								type="button"
								className="ws-button small"
								onClick={() => setChatPicker(true)}
							>
								<Trans>Chat</Trans>
							</button>
						)}
						{connection?.capabilities?.files && (
							<button
								type="button"
								className="ws-button small"
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
							</button>
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

import type { ModifierEvent } from "renderer/lib/clickPolicy/types";
import type { BrowserLinkAction } from "shared/workstation-browser-preferences";
import { Trans } from "@lingui/react/macro";
import type { RestoreResourceCheck } from "@superset/shared/workspace-restore";
import { useState } from "react";
import type {
	DirectDescriptor,
	DirectWorkstationApi,
} from "../../../../../../../shared/direct-workstation";
import type { WorkspacePaneV2 as WorkspacePane } from "../../../../../../../shared/workspace-view-v2";
import { RemoteChat } from "../../../RemoteChat/RemoteChat";
import {
	RemoteTerminal,
	type TerminalClipboardControls,
	type TerminalEmulator,
} from "../../../RemoteTerminal/RemoteTerminal";
import type { TerminalFileTarget } from "../../../RemoteTerminal/utils/terminal-file-links/terminal-file-links";
import { WorkspaceBrowserPane } from "../WorkspaceBrowserPane";
import type { WorkspaceViewActions } from "../../../../hooks/useWorkspaceViews/useWorkspaceViews";

export function WorkspacePaneView({
	api,
	connection,
	workspaceId,
	pane,
	check,
	active,
	allowed,
	onFocus,
	onChat,
	onRetry,
	onAttached,
	onFailed,
	createEmulator,
	onOpenFile,
	onOpenUrl,
	resolveUrlAction,
	onClipboardControls,
	actions,
}: {
	api: DirectWorkstationApi;
	connection: DirectDescriptor | null;
	workspaceId: string;
	pane: WorkspacePane;
	check?: RestoreResourceCheck;
	active: boolean;
	allowed: boolean;
	onFocus(): void;
	onChat(id: string): void;
	onRetry(): void;
	onAttached(): void;
	onFailed(): void;
	createEmulator?(element: HTMLDivElement): TerminalEmulator;
	onOpenFile?(target: TerminalFileTarget): void;
	onOpenUrl?(url: string, action?: BrowserLinkAction): void;
	resolveUrlAction?(event: ModifierEvent): BrowserLinkAction | null;
	onClipboardControls?(controls: TerminalClipboardControls): () => void;
	actions: WorkspaceViewActions;
}) {
	const [state, setState] = useState<
		"pending" | "attached" | "failed" | "ended"
	>("pending");
	const live =
		state !== "ended" &&
		connection?.capabilities?.workspaceViewRestoreV1 &&
		check?.state === "live" &&
		(pane.kind === "chat" ||
			(!!pane.executionId && check.executionId === pane.executionId));
	const failed = state === "failed";
	return (
		<section
			className="ws-workspace-pane"
			data-pane-id={pane.paneId}
			data-active={active}
			data-resource-state={
				state === "ended"
					? "exited"
					: failed
						? "unknown"
						: (check?.state ?? "unknown")
			}
			onFocusCapture={() => {
				if (!active) onFocus();
			}}
			onPointerDown={() => {
				if (!active) onFocus();
			}}
		>
			<div className="ws-pane-content">
				{pane.kind === "browser" && connection && actions.browserEnabled ? (
					<WorkspaceBrowserPane
						api={api}
						connection={connection}
						workspaceId={workspaceId}
						pane={pane}
						actions={actions}
						onFocus={onFocus}
					/>
				) : live && !failed && allowed && connection ? (
					pane.kind === "terminal" ? (
						<RemoteTerminal
							fill
							api={api}
							connection={connection}
							terminalId={pane.resourceId}
							restoreRef={{
								workspaceId,
								kind: "terminal",
								resourceId: pane.resourceId,
								executionId: pane.executionId,
							}}
							focused={active}
							onAttached={() => {
								setState("attached");
								onAttached();
							}}
							onExited={() => {
								setState("ended");
								onFailed();
							}}
							onError={() => {
								setState("failed");
								onFailed();
							}}
							createEmulator={createEmulator}
							onOpenFile={onOpenFile}
							onOpenUrl={onOpenUrl}
							resolveUrlAction={resolveUrlAction}
							onClipboardControls={onClipboardControls}
						/>
					) : (
						<RemoteChat
							api={api}
							connection={connection}
							workspaceId={workspaceId}
							selectedSessionId={pane.resourceId}
							onSessionSelected={(id) => {
								if (id) onChat(id);
							}}
							onAttached={() => {
								setState("attached");
								onAttached();
							}}
							onError={() => {
								setState("failed");
								onFailed();
							}}
						/>
					)
				) : (
					<output className="ws-pane-placeholder">
						{check?.reason === "execution-changed" ? (
							<Trans>This terminal was restarted.</Trans>
						) : state === "ended" || check?.state === "exited" ? (
							<Trans>Ended</Trans>
						) : check?.state === "interrupted" ? (
							<Trans>Interrupted</Trans>
						) : pane.kind === "terminal" && !pane.executionId ? (
							<Trans>Original execution cannot be confirmed.</Trans>
						) : (
							<Trans>Session status unavailable.</Trans>
						)}
						<button type="button" className="ws-button small" onClick={onRetry}>
							<Trans>Retry</Trans>
						</button>
					</output>
				)}
			</div>
		</section>
	);
}

import { Trans, useLingui } from "@lingui/react/macro";
import {
	ArrowLeft,
	Files,
	Monitor,
	Plus,
	Sparkles,
	Terminal,
} from "lucide-react";
import { useState } from "react";
import type {
	DirectDescriptor,
	DirectProfile,
	DirectWorkstationApi,
	RemoteWorkspace,
} from "../../types";
import { RemoteChat } from "../RemoteChat/RemoteChat";
import { RemoteFiles } from "../RemoteFiles/RemoteFiles";
import { RemoteTerminal } from "../RemoteTerminal/RemoteTerminal";

export function WorkspaceEditor({
	api,
	connection,
	profile,
	workspace,
	terminalIds,
	terminalId,
	busy,
	reconnecting,
	onNewSession,
	forward,
	onBack,
	onMachines,
	onError,
	onTerminal,
	onNewTerminal,
	onOpenPort,
	onClosePort,
	onRefresh,
	onPending,
}: {
	api: DirectWorkstationApi;
	connection: DirectDescriptor;
	profile: DirectProfile;
	workspace: RemoteWorkspace;
	terminalIds: string[];
	terminalId: string | null;
	busy: boolean;
	reconnecting: false | "reconnecting" | "blocked";
	onNewSession(): void;
	forward: { id: string; url: string } | null;
	onBack(): void;
	onMachines(): void;
	onError(error: string): void;
	onTerminal(id: string): void;
	onNewTerminal(): void;
	onOpenPort(port: number): void;
	onClosePort(): void;
	onRefresh(): void;
	onPending(): void;
}) {
	const { t } = useLingui();
	const [tab, setTab] = useState(
		connection.capabilities?.chat
			? "chat"
			: connection.capabilities?.files
				? "files"
				: "terminal",
	);
	return (
		<>
			<button type="button" className="ws-link" onClick={onBack}>
				<ArrowLeft size={14} />
				<Trans>Workspaces</Trans>
			</button>
			<div className="ws-heading editor-heading">
				<div>
					<h1>{workspace.name}</h1>
					<p className="ws-description">
						{profile.kind === "local"
							? t({ message: "Local Device" })
							: profile.name}
					</p>
					<code className="ws-worktree-path">{workspace.worktreePath}</code>
				</div>
				<button type="button" className="ws-button" onClick={onMachines}>
					<Monitor size={15} />
					<Trans>SSH machines</Trans>
				</button>
			</div>
			<div className="ws-editor-toolbar">
				<button
					type="button"
					className="ws-button small"
					disabled={
						busy ||
						!connection.capabilities?.sessions ||
						!connection.capabilities?.durableOperations
					}
					onClick={onNewSession}
				>
					<Plus size={14} />
					<Trans>New session</Trans>
				</button>
				<button
					type="button"
					className="ws-button small"
					disabled={busy}
					onClick={onRefresh}
				>
					<Trans>Refresh</Trans>
				</button>
				<button
					type="button"
					className="ws-button small"
					disabled={busy}
					onClick={onPending}
				>
					<Trans>Check pending action</Trans>
				</button>
			</div>
			<div className="ws-editor">
				<div className="ws-editor-tabs">
					{connection.capabilities?.chat && (
						<button
							type="button"
							className={tab === "chat" ? "active" : ""}
							onClick={() => setTab("chat")}
						>
							<Sparkles size={14} />
							<Trans>Chat</Trans>
						</button>
					)}
					{connection.capabilities?.files && (
						<button
							type="button"
							className={tab === "files" ? "active" : ""}
							onClick={() => setTab("files")}
						>
							<Files size={14} />
							<Trans>Files</Trans>
						</button>
					)}
					<button
						type="button"
						className={tab === "terminal" ? "active" : ""}
						onClick={() => setTab("terminal")}
					>
						<Terminal size={14} />
						<Trans>Terminal</Trans>
					</button>
					<span className={`ws-status ${reconnecting ? "" : "connected"}`}>
						<i />
						{reconnecting === false ? (
							<Trans>Connected</Trans>
						) : reconnecting === "blocked" ? (
							<Trans>Reconnect manually</Trans>
						) : (
							<Trans>Reconnecting</Trans>
						)}
					</span>
				</div>
				<div className="ws-editor-body">
					{connection.capabilities?.chat && (
						<div hidden={tab !== "chat"}>
							<RemoteChat
								key={`chat:${workspace.id}`}
								api={api}
								connection={connection}
								workspaceId={workspace.id}
								onError={onError}
							/>
						</div>
					)}
					{connection.capabilities?.files && (
						<div hidden={tab !== "files"}>
							<RemoteFiles
								key={`files:${connection.generation}:${workspace.id}`}
								api={api}
								connection={connection}
								workspaceId={workspace.id}
								onError={onError}
							/>
						</div>
					)}
					{
						<div hidden={tab !== "terminal"}>
							<div className="ws-terminal-tabs">
								{terminalIds.map((id, index) => (
									<button
										type="button"
										className={`ws-button small ${terminalId === id ? "selected" : ""}`}
										key={id}
										onClick={() => onTerminal(id)}
									>
										#{index + 1}
									</button>
								))}
								<button
									type="button"
									className="ws-button small"
									disabled={
										busy ||
										!connection.capabilities?.terminals ||
										!connection.capabilities?.durableOperations
									}
									onClick={onNewTerminal}
								>
									<Plus size={14} />
									<Trans>New terminal</Trans>
								</button>
							</div>
							{terminalId && (
								<RemoteTerminal
									key={`${connection.generation}:${terminalId}`}
									api={api}
									connection={connection}
									terminalId={terminalId}
									onError={onError}
								/>
							)}
							<form
								className="ws-port-form"
								onSubmit={(e) => {
									e.preventDefault();
									onOpenPort(Number(new FormData(e.currentTarget).get("port")));
								}}
							>
								<label className="ws-field">
									<Trans>Port</Trans>
									<input
										name="port"
										type="number"
										min={1}
										max={65535}
										required
									/>
								</label>
								<button className="ws-button" type="submit" disabled={busy}>
									<Trans>Open port</Trans>
								</button>
							</form>
							{forward && (
								<div className="ws-service-actions">
									<code>{forward.url}</code>
									<button
										type="button"
										className="ws-button small"
										onClick={onClosePort}
									>
										<Trans>Close</Trans>
									</button>
								</div>
							)}
						</div>
					}
				</div>
			</div>
		</>
	);
}

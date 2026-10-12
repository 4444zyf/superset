import { Trans, useLingui } from "@lingui/react/macro";
import { ArrowRight, Folder, Link2, Plus, RefreshCw } from "lucide-react";
import type {
	DirectProfile,
	RemoteProject,
	RemoteWorkspace,
} from "../../types";

export function WorkspaceBrowser({
	profiles,
	selectedId,
	connected,
	canAddProject,
	canCreateSession,
	projects,
	workspaces,
	busy,
	projectId,
	onTarget,
	onConnect,
	onMachines,
	onAddProject,
	onNewSession,
	onOpen,
	onRefresh,
	onPending,
}: {
	profiles: DirectProfile[];
	selectedId: string;
	connected: boolean;
	canAddProject: boolean;
	canCreateSession: boolean;
	projects: RemoteProject[];
	workspaces: RemoteWorkspace[];
	busy: boolean;
	projectId: string | null;
	onTarget(id: string): void;
	onConnect(): void;
	onMachines(): void;
	onAddProject(): void;
	onNewSession(): void;
	onOpen(id: string): void;
	onRefresh(): void;
	onPending(): void;
}) {
	const { t } = useLingui();
	const selected = profiles.find((p) => p.id === selectedId),
		project = projects.find((p) => p.id === projectId);
	return (
		<>
			<div className="ws-heading">
				<div>
					<div className="ws-eyebrow">
						{selected?.kind === "local" ? (
							<Trans>Local Device</Trans>
						) : (
							selected?.name || t({ message: "Personal workspace" })
						)}
					</div>
					<h1>{project?.name || t({ message: "Workspaces" })}</h1>
					<p className="ws-description">
						<Trans>Choose where your projects and sessions run.</Trans>
					</p>
				</div>
				<div className="ws-heading-actions">
					<button
						type="button"
						className="ws-button"
						disabled={busy || !connected || !canAddProject}
						onClick={onAddProject}
					>
						<Folder size={15} />
						<Trans>Add project</Trans>
					</button>
					<button
						type="button"
						className="ws-button primary"
						disabled={busy || !connected || !canCreateSession}
						onClick={onNewSession}
					>
						<Plus size={15} />
						<Trans>New session</Trans>
					</button>
				</div>
			</div>
			<div className="ws-location-bar">
				<label>
					<Trans>Run on</Trans>
					<select
						aria-label={t({ message: "Run on" })}
						value={selectedId}
						disabled={busy}
						onChange={(e) => onTarget(e.target.value)}
					>
						{profiles.map((p) => (
							<option key={p.id} value={p.id}>
								{p.kind === "local" ? t({ message: "Local Device" }) : p.name}
							</option>
						))}
					</select>
				</label>
				<button type="button" className="ws-link" onClick={onMachines}>
					<Trans>SSH machines</Trans>
					<ArrowRight size={14} />
				</button>
				{connected && (
					<>
						<button
							type="button"
							className="ws-button small"
							disabled={busy}
							onClick={onRefresh}
						>
							<RefreshCw size={14} />
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
					</>
				)}
			</div>
			{!connected ? (
				<div className="ws-empty">
					<Link2 size={28} />
					<p>
						<Trans>Connect to view workspaces</Trans>
					</p>
					<button
						type="button"
						className="ws-button primary"
						disabled={busy || !selected}
						onClick={onConnect}
					>
						<Trans>Connect</Trans>
					</button>
				</div>
			) : (
				<div className="ws-workspace-grid">
					{workspaces
						.filter((w) => !projectId || w.projectId === projectId)
						.map((w) => (
							<button
								type="button"
								className="ws-workspace-card"
								key={w.id}
								aria-label={w.name}
								onClick={() => onOpen(w.id)}
								disabled={busy}
							>
								<span className="ws-card-project">
									<Folder size={13} />
									{projects.find((p) => p.id === w.projectId)?.name ||
										t({ message: "Session" })}
								</span>
								<h2>{w.name}</h2>
								<code>{w.worktreePath}</code>
								<div>
									<span>
										{selected?.kind === "local"
											? t({ message: "Local Device" })
											: selected?.name}
									</span>
									<span className="ws-status connected">
										<i />
										<Trans>Connected</Trans>
									</span>
								</div>
							</button>
						))}
					{!workspaces.length && (
						<div className="ws-empty">
							<Folder size={28} />
							<p>
								<Trans>No workspaces yet</Trans>
							</p>
							<button
								type="button"
								className="ws-button"
								onClick={onNewSession}
								disabled={busy || !canCreateSession}
							>
								<Plus size={15} />
								<Trans>New session</Trans>
							</button>
						</div>
					)}
				</div>
			)}
		</>
	);
}

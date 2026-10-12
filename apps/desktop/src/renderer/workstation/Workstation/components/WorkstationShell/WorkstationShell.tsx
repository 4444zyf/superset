import { Trans, useLingui } from "@lingui/react/macro";
import { Folder, Grid2X2, Laptop, Monitor, ShieldCheck } from "lucide-react";
import type { ReactNode } from "react";
import type { RemoteProject } from "../../types";

export function WorkstationShell({
	page,
	projects,
	children,
	onNavigate,
	onProject,
}: {
	page: "machines" | "workspaces";
	projects: RemoteProject[];
	children: ReactNode;
	onNavigate(page: "machines" | "workspaces"): void;
	onProject(id: string): void;
}) {
	const { t } = useLingui();
	return (
		<div className="ssh-workstation">
			<div className="ws-titlebar">
				<span>Superset</span>
				<span>
					<ShieldCheck size={12} />
					<Trans>Direct SSH</Trans>
				</span>
			</div>
			<div className="ws-shell">
				<aside className="ws-sidebar">
					<div className="ws-brand">
						<svg viewBox="0 0 30 30" aria-hidden="true">
							<path d="M5 10l10-6 10 6-10 6-10-6zM5 16l10 6 10-6M5 22l10 6 10-6" />
						</svg>
						<span>superset</span>
					</div>
					<nav>
						<button
							type="button"
							className={page === "workspaces" ? "active" : ""}
							aria-label={t({ message: "Workspaces" })}
							aria-current={page === "workspaces" ? "page" : undefined}
							onClick={() => onNavigate("workspaces")}
						>
							<Grid2X2 size={17} />
							<Trans>Workspaces</Trans>
						</button>
						<button
							type="button"
							className={page === "machines" ? "active" : ""}
							aria-label={t({ message: "SSH machines" })}
							aria-current={page === "machines" ? "page" : undefined}
							onClick={() => onNavigate("machines")}
						>
							<Monitor size={17} />
							<Trans>SSH machines</Trans>
						</button>
					</nav>
					<div className="ws-sidebar-projects">
						<p className="ws-eyebrow">
							<Trans>Projects</Trans>
						</p>
						{projects.map((p) => (
							<button
								type="button"
								key={p.id}
								title={p.name}
								onClick={() => onProject(p.id)}
							>
								<Folder size={14} />
								<span>{p.name}</span>
							</button>
						))}
					</div>
					<div className="ws-sidebar-local">
						<Laptop size={17} />
						<div>
							<strong>
								<Trans>Local Device</Trans>
							</strong>
							<p>
								<Trans>Connection settings are stored on this device.</Trans>
							</p>
						</div>
					</div>
				</aside>
				<main className="ws-main">{children}</main>
			</div>
		</div>
	);
}

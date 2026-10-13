import { Trans, useLingui } from "@lingui/react/macro";
import { formatNumber, formatRelativeTime } from "@superset/i18n/format";
import {
	ArrowRight,
	Clock3,
	HardDrive,
	Laptop,
	MoreHorizontal,
	Plus,
	Search,
	ShieldCheck,
} from "lucide-react";
import { type ReactNode, type RefObject, useState } from "react";
import type { DirectSetupSnapshot } from "../../../../../shared/direct-workstation";
import type {
	ControlAction,
	DirectProfile,
	MachineProbe,
	MachineSnapshot,
} from "../../types";
import { SetupProgress } from "../SetupProgress";

export function MachineManager({
	profiles,
	selectedId,
	activeId,
	busy,
	reconnecting,
	snapshots,
	probes,
	setups = {},
	password,
	localData,
	onSelect,
	onConnect,
	onDisconnect,
	onEdit,
	onAdd,
	onRemove,
	onControl,
	onTest,
	onRelease,
	onImport,
	onWorkspaces,
}: {
	profiles: DirectProfile[];
	selectedId: string;
	activeId?: string;
	busy: boolean;
	reconnecting: false | "reconnecting" | "blocked";
	snapshots: Record<string, MachineSnapshot>;
	probes: Record<string, MachineProbe>;
	setups?: Record<string, DirectSetupSnapshot>;
	password: RefObject<HTMLInputElement | null>;
	localData?: ReactNode;
	onSelect(id: string): void;
	onConnect(profile: DirectProfile): void;
	onDisconnect(): void;
	onEdit(profile: DirectProfile): void;
	onAdd(): void;
	onRemove(profile: DirectProfile): void;
	onControl(profile: DirectProfile, action: ControlAction): void;
	onTest(profile: DirectProfile): void;
	onRelease(profile: DirectProfile): void;
	onImport(profile: DirectProfile): void;
	onWorkspaces(profile: DirectProfile): void;
}) {
	const { t, i18n } = useLingui();
	const [query, setQuery] = useState("");
	const [filter, setFilter] = useState("all");
	const [tab, setTab] = useState("workspaces");
	const [menu, setMenu] = useState(false);
	const selected = profiles.find((p) => p.id === selectedId),
		remote = profiles.filter((p) => p.kind !== "local"),
		local = profiles.find((p) => p.kind === "local");
	const live = selected?.id === activeId && !reconnecting;
	const status = (id: string) =>
		id === activeId
			? reconnecting === "blocked"
				? t({ message: "Reconnect manually" })
				: reconnecting
					? t({ message: "Reconnecting" })
					: t({ message: "Connected" })
			: t({ message: "Not connected" });
	const rows = remote.filter(
		(p) =>
			(filter === "all" ||
				(p.id === activeId && !reconnecting) === (filter === "connected")) &&
			`${p.name} ${p.host} ${p.user ?? ""}`
				.toLowerCase()
				.includes(query.toLowerCase()),
	);
	return (
		<>
			<div className="ws-heading">
				<div>
					<div className="ws-eyebrow">
						<Trans>Personal workspace</Trans>
					</div>
					<h1>
						<Trans>SSH machines</Trans>
					</h1>
					<p className="ws-description">
						<Trans>
							Connect directly to your machine. Agents keep running when this
							app closes.
						</Trans>
					</p>
				</div>
				<button
					type="button"
					className="ws-button primary"
					onClick={onAdd}
					disabled={busy}
				>
					<Plus size={16} />
					<Trans>Add machine</Trans>
				</button>
			</div>
			<div className="ws-metrics">
				<span>
					<b>{formatNumber(remote.length, {}, i18n.locale)}</b>
					<Trans>SSH machines</Trans>
				</span>
				<span>
					<b>
						{formatNumber(
							activeId && remote.some((p) => p.id === activeId) && !reconnecting
								? 1
								: 0,
							{},
							i18n.locale,
						)}
					</b>
					<Trans>Connected</Trans>
				</span>
				<span>
					<b>
						{formatNumber(
							activeId ? (snapshots[activeId]?.workspaces.length ?? 0) : 0,
							{},
							i18n.locale,
						)}
					</b>
					<Trans>Workspaces</Trans>
				</span>
				<div>
					<ShieldCheck size={14} />
					<Trans>Direct SSH</Trans>
				</div>
			</div>
			<div className="ws-machine-layout">
				<section>
					<div className="ws-toolbar">
						<div className="ws-filters">
							{[
								["all", t({ message: "All" })],
								["connected", t({ message: "Connected" })],
								["disconnected", t({ message: "Not connected" })],
							].map(([value, label]) => (
								<button
									type="button"
									key={value}
									className={filter === value ? "active" : ""}
									aria-pressed={filter === value}
									onClick={() => setFilter(value)}
								>
									{label}
								</button>
							))}
						</div>
						<label className="ws-search">
							<Search size={14} />
							<input
								aria-label={t({ message: "Search machines" })}
								placeholder={t({ message: "Search machines" })}
								value={query}
								onChange={(e) => setQuery(e.target.value)}
							/>
						</label>
					</div>
					<div className="ws-table-heading">
						<span>
							<Trans>Machine</Trans>
						</span>
						<span>
							<Trans>Status</Trans>
						</span>
						<span>
							<Trans>Workspaces</Trans>
						</span>
					</div>
					<div className="ws-machine-list">
						{rows.map((p) => (
							<button
								type="button"
								key={p.id}
								className={`ws-machine-row ${p.id === selectedId ? "selected" : ""}`}
								aria-label={p.name}
								aria-pressed={p.id === selectedId}
								onClick={() => {
									onSelect(p.id);
									setTab("workspaces");
									setMenu(false);
								}}
							>
								<div className="ws-machine-name">
									<span className="ws-device-icon">
										<HardDrive size={21} />
									</span>
									<div>
										<strong>{p.name}</strong>
										<code>
											{p.user ? `${p.user}@` : ""}
											{p.host}
										</code>
									</div>
								</div>
								<span
									className={`ws-status ${p.id === activeId && !reconnecting ? "connected" : ""}`}
								>
									<i />
									{status(p.id)}
								</span>
								<span className="ws-row-count">
									{snapshots[p.id]
										? formatNumber(
												snapshots[p.id].workspaces.length,
												{},
												i18n.locale,
											)
										: "—"}
								</span>
							</button>
						))}
						{!rows.length && (
							<div className="ws-empty">
								<HardDrive size={26} />
								<p>
									{remote.length ? (
										<Trans>No machines found</Trans>
									) : (
										<Trans>Add your first SSH machine</Trans>
									)}
								</p>
								<button type="button" className="ws-button" onClick={onAdd}>
									<Plus size={15} />
									<Trans>Add machine</Trans>
								</button>
							</div>
						)}
					</div>
					{local && (
						<div className="ws-local-row">
							<Laptop size={20} />
							<div>
								<strong>
									<Trans>Local Device</Trans>
								</strong>
								<p>
									<Trans>Local projects and sessions</Trans>
								</p>
							</div>
							<button
								type="button"
								className="ws-button small"
								onClick={() => {
									onSelect(local.id);
									setTab("workspaces");
								}}
							>
								<Trans>Manage</Trans>
							</button>
							<button
								type="button"
								className="ws-button small"
								disabled={busy}
								onClick={() => onWorkspaces(local)}
							>
								<Trans>Workspaces</Trans>
								<ArrowRight size={14} />
							</button>
						</div>
					)}
					<div className="ws-info">
						<Clock3 size={18} />
						<div>
							<strong>
								<Trans>Disconnect keeps remote tasks running</Trans>
							</strong>
							<p>
								<Trans>
									Connect directly to your machine. Agents keep running when
									this app closes.
								</Trans>
							</p>
						</div>
					</div>
				</section>
				<aside className="ws-detail">
					{selected ? (
						<>
							<div className="ws-detail-head">
								<div className="ws-detail-top">
									<span className="ws-device-icon">
										{selected.kind === "local" ? (
											<Laptop size={23} />
										) : (
											<HardDrive size={23} />
										)}
									</span>
									<span className={`ws-status ${live ? "connected" : ""}`}>
										<i />
										{status(selected.id)}
									</span>
									{selected.kind !== "local" && (
										<div className="ws-menu-anchor">
											<button
												type="button"
												className="ws-icon-button"
												aria-label={t({ message: "More actions" })}
												aria-expanded={menu}
												onClick={() => setMenu(!menu)}
											>
												<MoreHorizontal size={18} />
											</button>
											{menu && (
												<div className="ws-popover">
													<button
														type="button"
														onClick={() => {
															setMenu(false);
															onEdit(selected);
														}}
														disabled={busy}
													>
														<Trans>Edit connection</Trans>
													</button>
													<button
														type="button"
														onClick={() => {
															setMenu(false);
															onTest(selected);
														}}
														disabled={busy}
													>
														<Trans>Test connection</Trans>
													</button>
													<button
														type="button"
														className="danger"
														onClick={() => {
															setMenu(false);
															onRemove(selected);
														}}
														disabled={busy}
													>
														<Trans>Remove</Trans>
													</button>
												</div>
											)}
										</div>
									)}
								</div>
								<h2>
									{selected.kind === "local" ? (
										<Trans>Local Device</Trans>
									) : (
										selected.name
									)}
								</h2>
								<code>
									{selected.kind === "local"
										? t({ message: "Local projects and sessions" })
										: `${selected.user ? `${selected.user}@` : ""}${selected.host}${selected.port ? ` : ${selected.port}` : ""}`}
								</code>
								{probes[selected.id] && (
									<p className="ws-description">
										{probes[selected.id].platform} ·{" "}
										{probes[selected.id].architecture}
									</p>
								)}
								{setups[selected.id] && (
									<SetupProgress snapshot={setups[selected.id]} />
								)}
								<div className="ws-detail-actions">
									{live ? (
										<>
											<button
												type="button"
												className="ws-button primary"
												onClick={() => onWorkspaces(selected)}
											>
												<Trans>Open workspace</Trans>
												<ArrowRight size={15} />
											</button>
											<button
												type="button"
												className="ws-button"
												disabled={busy}
												onClick={onDisconnect}
											>
												<Trans>Disconnect</Trans>
											</button>
										</>
									) : (
										<button
											type="button"
											className="ws-button primary"
											disabled={busy}
											onClick={() => onConnect(selected)}
										>
											<Trans>Connect</Trans>
											<ArrowRight size={15} />
										</button>
									)}
								</div>
							</div>
							<div className="ws-detail-tabs">
								<button
									type="button"
									className={tab === "workspaces" ? "active" : ""}
									onClick={() => setTab("workspaces")}
								>
									<Trans>Workspaces</Trans>
								</button>
								<button
									type="button"
									className={tab === "connection" ? "active" : ""}
									onClick={() => setTab("connection")}
								>
									<Trans>Connection details</Trans>
								</button>
							</div>
							<div className="ws-detail-body">
								{tab === "workspaces" ? (
									<>
										<p className="ws-eyebrow">
											{live ? (
												<Trans>Workspaces</Trans>
											) : (
												<Trans>Last synced</Trans>
											)}
										</p>
										{snapshots[selected.id]?.workspaces.length ? (
											snapshots[selected.id].workspaces.map((w) => (
												<button
													type="button"
													className="ws-workspace-item"
													key={w.id}
													onClick={() => onWorkspaces(selected)}
												>
													<span>{w.name}</span>
													<ArrowRight size={14} />
												</button>
											))
										) : (
											<p className="ws-description">
												<Trans>Connect to view workspaces</Trans>
											</p>
										)}
										<div className="ws-info compact">
											<Clock3 size={15} />
											<p>
												<Trans>Disconnect keeps remote tasks running</Trans>
											</p>
										</div>
									</>
								) : (
									<>
										<div className="ws-kv">
											<span>
												<Trans>SSH host</Trans>
											</span>
											<code>{selected.host}</code>
										</div>
										<div className="ws-kv">
											<span>
												<Trans>SSH user</Trans>
											</span>
											<code>{selected.user || "—"}</code>
										</div>
										<div className="ws-kv">
											<span>
												<Trans>Port</Trans>
											</span>
											<code>{selected.port ?? 22}</code>
										</div>
										<div className="ws-kv">
											<span>
												<Trans>Identity file</Trans>
											</span>
											<code>
												{selected.identityFile ||
													t({ message: "SSH config alias" })}
											</code>
										</div>
										{selected.kind !== "local" && (
											<div className="ws-service-actions">
												<button
													type="button"
													className="ws-button small"
													disabled={busy}
													onClick={() => onTest(selected)}
												>
													<Trans>Test connection</Trans>
												</button>
												<button
													type="button"
													className="ws-button small"
													disabled={busy}
													onClick={() => onControl(selected, "start")}
												>
													<Trans>Start</Trans>
												</button>
												<button
													type="button"
													className="ws-button small danger"
													disabled={busy}
													onClick={() => onControl(selected, "stop")}
												>
													<Trans>Stop</Trans>
												</button>
											</div>
										)}
										{selected.kind !== "local" && (
											<details className="ws-advanced">
												<summary>
													<Trans>Backend settings</Trans>
												</summary>
												<label className="ws-field">
													<Trans>Administrator password</Trans>
													<input
														ref={password}
														type="password"
														autoComplete="off"
													/>
												</label>
												<p className="ws-description">
													<Trans>
														Optional, used once to install the backend on the
														remote machine.
													</Trans>
												</p>
												<div className="ws-service-actions">
													<button
														type="button"
														className="ws-button small"
														disabled={busy}
														onClick={() => onRelease(selected)}
													>
														<Trans>Select backend release</Trans>
													</button>
													{(
														[
															["install", "Install"],
															["activate", "Update"],
															["repair", "Repair backend"],
															["uninstall", "Uninstall backend"],
														] as const
													).map(([action]) => (
														<button
															type="button"
															className="ws-button small"
															key={action}
															disabled={busy}
															onClick={() => onControl(selected, action)}
														>
															{action === "install" ? (
																<Trans>Install</Trans>
															) : action === "activate" ? (
																<Trans>Update</Trans>
															) : action === "repair" ? (
																<Trans>Repair backend</Trans>
															) : (
																<Trans>Uninstall backend</Trans>
															)}
														</button>
													))}
												</div>
											</details>
										)}
										<p className="ws-description">
											<Trans>
												Before the first SSH connection, run SSH in your system
												terminal and verify the host fingerprint.
											</Trans>
										</p>
									</>
								)}
								{selected.kind === "local" && tab === "connection" && (
									<div className="ws-local-data">
										{localData}
										<div className="ws-service-actions">
											<button
												type="button"
												className="ws-button small"
												disabled={busy || activeId === selected.id}
												onClick={() => onImport(selected)}
											>
												<Trans>Import local data</Trans>
											</button>
											<button
												type="button"
												className="ws-button small"
												disabled={busy}
												onClick={() => onControl(selected, "start")}
											>
												<Trans>Start</Trans>
											</button>
											<button
												type="button"
												className="ws-button small danger"
												disabled={busy}
												onClick={() => onControl(selected, "stop")}
											>
												<Trans>Stop</Trans>
											</button>
										</div>
										<p className="ws-description">
											<Trans>
												For folder import, stop the selected backend first, then
												start it after import.
											</Trans>
										</p>
									</div>
								)}
							</div>
							<div className="ws-detail-footer">
								{snapshots[selected.id] ? (
									<>
										<Trans>Last synced</Trans>
										<span>
											{formatRelativeTime(
												snapshots[selected.id].syncedAt,
												Date.now(),
												undefined,
												i18n.locale,
											)}
										</span>
									</>
								) : (
									<Trans>Connection settings are stored on this device.</Trans>
								)}
							</div>
						</>
					) : (
						<div className="ws-empty">
							<Trans>Add your first SSH machine</Trans>
						</div>
					)}
				</aside>
			</div>
		</>
	);
}

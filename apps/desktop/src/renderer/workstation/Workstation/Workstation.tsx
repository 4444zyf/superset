import { Trans, useLingui } from "@lingui/react/macro";
import { useEffect, useRef, useState } from "react";
import { LocalDataPanel } from "./components/LocalDataPanel";
import { MachineForm } from "./components/MachineForm/MachineForm";
import { MachineManager } from "./components/MachineManager/MachineManager";
import { ProjectDialog } from "./components/ProjectDialog/ProjectDialog";
import { SessionDialog } from "./components/SessionDialog/SessionDialog";
import { WorkspaceBrowser } from "./components/WorkspaceBrowser/WorkspaceBrowser";
import { WorkspaceEditor } from "./components/WorkspaceEditor/WorkspaceEditor";
import { WorkstationDialog } from "./components/WorkstationDialog/WorkstationDialog";
import { WorkstationShell } from "./components/WorkstationShell/WorkstationShell";
import { useWorkstation } from "./hooks/useWorkstation/useWorkstation";
import type {
	DirectProfile,
	DirectWorkstationApi,
	RemoteDirectory,
	RemoteWorkspace,
} from "./types";
import "./workstation.css";

export function Workstation({
	api = window.directWorkstation,
}: {
	api?: DirectWorkstationApi;
}) {
	const { t } = useLingui();
	const ui = useWorkstation(api);
	const [page, setPage] = useState<"machines" | "workspaces">("machines");
	const [selectedId, setSelectedId] = useState("");
	const selectedRef = useRef("");
	const navigationRevision = useRef(0);
	const [projectId, setProjectId] = useState<string | null>(null);
	const [form, setForm] = useState<"add" | DirectProfile | null>(null);
	const [create, setCreate] = useState<"project" | "session" | null>(null);
	const createRef = useRef(create);
	createRef.current = create;
	const [remove, setRemove] = useState<DirectProfile | null>(null);
	const select = (id: string) => {
		selectedRef.current = id;
		setSelectedId(id);
		setProjectId(null);
		ui.setDirectory(null);
	};
	useEffect(() => {
		if (!ui.profiles.some((p) => p.id === selectedRef.current)) {
			const id =
				ui.profiles.find((p) => p.kind !== "local")?.id ??
				ui.profiles[0]?.id ??
				"";
			selectedRef.current = id;
			setSelectedId(id);
		}
	}, [ui.profiles]);
	const selected = ui.profiles.find((p) => p.id === selectedId);
	const attached = Boolean(
		ui.connection && ui.connection.connectionId === selectedId,
	);
	const connected = attached && !ui.reconnecting;
	const visibleProjects = attached ? ui.projects : [];
	const visibleWorkspaces = attached ? ui.workspaces : [];
	const workspace = visibleWorkspaces.find((w) => w.id === ui.workspaceId);
	const browse = (path?: string) =>
		ui.operation(async () => {
			const target = ui.active.current;
			if (!target || target.connectionId !== selectedRef.current) return;
			const directory = await ui.rpc<RemoteDirectory>(
				"filesystem.browseHost",
				"query",
				path ? { path } : {},
				target,
			);
			if (
				ui.active.current === target &&
				selectedRef.current === target.connectionId &&
				createRef.current === "project"
			)
				ui.setDirectory(directory);
		});
	const connect = async (profile: DirectProfile, open = true) => {
		const navigation = navigationRevision.current;
		select(profile.id);
		if (ui.active.current?.connectionId !== profile.id || ui.reconnecting)
			await ui.connect(profile);
		if (
			ui.active.current?.connectionId !== profile.id ||
			selectedRef.current !== profile.id
		)
			return;
		if (open && navigation === navigationRevision.current) {
			ui.clearWorkspace();
			setPage("workspaces");
		}
		if (createRef.current === "project") await browse();
	};
	const changeTarget = (id: string) => {
		const profile = ui.profiles.find((p) => p.id === id);
		if (!profile || ui.busy) return;
		void connect(profile, false);
	};
	const openProject = () => {
		setCreate("project");
		createRef.current = "project";
		void browse();
	};
	const checkPending = () =>
		ui.operation(async () => {
			const target = ui.active.current;
			if (!target) return;
			const results = await api.reconcile(target.connectionId);
			if (ui.active.current !== target) return;
			ui.setPending(results as typeof ui.pending);
			ui.setNotice(
				results.length ? null : t({ message: "No pending actions." }),
			);
			await ui.refresh(target);
		});
	const createSession = (name: string, chosenProject: string) =>
		void ui.operation(async () => {
			const target = ui.active.current;
			if (
				!target ||
				target.connectionId !== selectedRef.current ||
				ui.reconnecting ||
				!target.capabilities?.durableOperations ||
				!target.capabilities?.sessions
			)
				return;
			if (chosenProject && !ui.projects.some((p) => p.id === chosenProject))
				throw new Error(t({ message: "Connect to view workspaces" }));
			const input = {
				id: crypto.randomUUID(),
				operationId: crypto.randomUUID(),
				name,
			};
			const result = await ui.rpc<{ workspace: RemoteWorkspace }>(
				chosenProject ? "workspaces.create" : "workspaces.createSession",
				"mutation",
				chosenProject
					? {
							...input,
							projectId: chosenProject,
							checkout: "local",
							runSetup: false,
						}
					: input,
				target,
			);
			if (
				ui.active.current !== target ||
				selectedRef.current !== target.connectionId
			)
				return;
			setCreate(null);
			await ui.refresh(target);
			await ui.selectWorkspace(result.workspace.id);
		});
	const projectMutation = (input: unknown) =>
		ui.operation(async () => {
			const target = ui.active.current;
			if (
				!target ||
				target.connectionId !== selectedRef.current ||
				!target.capabilities?.durableOperations ||
				!target.capabilities?.projects
			)
				return;
			await ui.rpc("project.create", "mutation", input, target);
			if (
				ui.active.current !== target ||
				selectedRef.current !== target.connectionId
			)
				return;
			setCreate(null);
			ui.setDirectory(null);
			await ui.refresh(target);
		});
	const closeCreate = () => {
		setCreate(null);
		createRef.current = null;
		ui.setDirectory(null);
	};
	const disabled = ui.busy || api.platform === "win32";
	return (
		<WorkstationShell
			page={page}
			projects={ui.connection?.connectionId === selectedId ? ui.projects : []}
			onNavigate={(next) => {
				navigationRevision.current++;
				setPage(next);
				if (next === "workspaces") ui.clearWorkspace();
			}}
			onProject={(id) => {
				setProjectId(id);
				setPage("workspaces");
				ui.clearWorkspace();
			}}
		>
			{api.platform === "win32" && (
				<output className="ws-notice">
					<Trans>Windows connections are not supported yet.</Trans>
				</output>
			)}
			{ui.error && !create && !form && (
				<p className="ws-error" role="alert">
					{ui.error}
				</p>
			)}
			{ui.notice && <output className="ws-notice">{ui.notice}</output>}
			{ui.reconnecting && (
				<output className="ws-notice">
					{ui.reconnecting === "blocked" ? (
						<Trans>Reconnect manually</Trans>
					) : (
						<Trans>Reconnecting</Trans>
					)}
				</output>
			)}
			{page === "machines" ? (
				<MachineManager
					profiles={ui.profiles}
					selectedId={selectedId}
					activeId={ui.connection?.connectionId}
					busy={disabled}
					reconnecting={ui.reconnecting}
					snapshots={ui.snapshots}
					probes={ui.probes}
					password={ui.password}
					onSelect={select}
					onConnect={(p) => void connect(p)}
					onDisconnect={() => void ui.disconnect()}
					onEdit={(p) => {
						ui.setError(null);
						setForm(p);
					}}
					onAdd={() => {
						ui.setError(null);
						setForm("add");
					}}
					onRemove={setRemove}
					onControl={(p, a) => void ui.control(p, a)}
					onTest={(p) => void ui.testProfile(p)}
					onRelease={(p) =>
						void ui.operation(async () => {
							await api.selectRelease(p.id);
						})
					}
					onImport={(p) => void ui.importLocalData(p)}
					onWorkspaces={(p) => void connect(p)}
					localData={
						selected?.kind === "local" &&
						api.localData &&
						api.platform !== "win32" ? (
							<LocalDataPanel
								api={api.localData}
								onError={ui.setError}
								onNamespaceSelected={(namespace) =>
									ui.namespaceSelected(selected.id, namespace)
								}
							/>
						) : undefined
					}
				/>
			) : (
				<fieldset className="ws-content" disabled={Boolean(ui.reconnecting)}>
					{workspace && attached && ui.connection && selected ? (
						<WorkspaceEditor
							reconnecting={ui.reconnecting}
							onNewSession={() => {
								ui.setError(null);
								setCreate("session");
							}}
							key={`${ui.connection.connectionId}:${workspace.id}`}
							api={api}
							connection={ui.connection}
							profile={selected}
							workspace={workspace}
							terminalIds={ui.terminalIds}
							terminalId={ui.terminalId}
							busy={disabled}
							forward={ui.forward}
							onBack={() => {
								ui.clearWorkspace();
							}}
							onMachines={() => setPage("machines")}
							onError={ui.setError}
							onTerminal={ui.setTerminalId}
							onRefresh={() =>
								void ui.operation(async () => {
									await ui.refresh(ui.active.current, true);
								})
							}
							onPending={() => void checkPending()}
							onNewTerminal={() =>
								void ui.operation(async () => {
									const target = ui.active.current;
									if (!target) return;
									const id = crypto.randomUUID();
									await ui.rpc(
										"terminal.createSession",
										"mutation",
										{
											workspaceId: workspace.id,
											terminalId: id,
											operationId: crypto.randomUUID(),
										},
										target,
									);
									if (ui.active.current !== target) return;
									ui.setTerminalIds((previous) => [...previous, id]);
									ui.setTerminalId(id);
								})
							}
							onOpenPort={(port) =>
								void ui.operation(async () => {
									const target = ui.active.current;
									if (!target) return;
									if (ui.forward) {
										await api.closePort(ui.forward.id);
										ui.setForward(null);
									}
									const forward = await api.openPort(
										target,
										workspace.id,
										port,
									);
									if (ui.active.current === target) ui.setForward(forward);
								})
							}
							onClosePort={() =>
								void ui.operation(async () => {
									if (ui.forward) {
										await api.closePort(ui.forward.id);
										ui.setForward(null);
									}
								})
							}
						/>
					) : (
						<WorkspaceBrowser
							canAddProject={Boolean(
								ui.connection?.capabilities?.projects &&
									ui.connection?.capabilities?.durableOperations,
							)}
							canCreateSession={Boolean(
								ui.connection?.capabilities?.sessions &&
									ui.connection?.capabilities?.durableOperations,
							)}
							profiles={ui.profiles}
							selectedId={selectedId}
							connected={connected}
							projects={visibleProjects}
							workspaces={visibleWorkspaces}
							busy={disabled}
							projectId={projectId}
							onTarget={changeTarget}
							onConnect={() => {
								if (selected) void connect(selected);
							}}
							onMachines={() => setPage("machines")}
							onAddProject={openProject}
							onNewSession={() => {
								ui.setError(null);
								setCreate("session");
							}}
							onOpen={(id) => void ui.operation(() => ui.selectWorkspace(id))}
							onRefresh={() =>
								void ui.operation(async () => {
									await ui.refresh(ui.active.current, true);
								})
							}
							onPending={() => void checkPending()}
						/>
					)}
				</fieldset>
			)}
			{ui.pending.length > 0 && (
				<ul className="ws-pending">
					{ui.pending.map((action) => (
						<li key={action.operationId}>
							<span>{ui.procedureLabel(action.procedure)}</span>
							<span>{ui.statusLabel(action.status)}</span>
							{action.status === "unresolved" && (
								<button
									type="button"
									className="ws-button small"
									disabled={disabled}
									onClick={() =>
										void ui.operation(async () => {
											const target = ui.active.current;
											if (!target) return;
											const acknowledged = await api.acknowledge(
												target,
												action.operationId,
											);
											if (ui.active.current !== target) return;
											if (acknowledged)
												ui.setPending((items) =>
													items.filter(
														(item) => item.operationId !== action.operationId,
													),
												);
											else ui.setNotice(t({ message: "Cancelled" }));
										})
									}
								>
									<Trans>Acknowledge unresolved action</Trans>
								</button>
							)}
						</li>
					))}
				</ul>
			)}
			{form && (
				<MachineForm
					serverError={ui.error}
					profile={form === "add" ? undefined : form}
					api={api}
					onClose={() => setForm(null)}
					onSave={async (profile) => {
						const saved = await ui.saveProfile(profile);
						if (saved) {
							select(saved.id);
							return true;
						}
						return false;
					}}
				/>
			)}
			{create === "session" && (
				<SessionDialog
					serverError={ui.error}
					profiles={ui.profiles}
					selectedId={selectedId}
					projects={visibleProjects}
					connected={
						connected &&
						Boolean(
							ui.connection?.capabilities?.sessions &&
								ui.connection?.capabilities?.durableOperations,
						)
					}
					busy={disabled}
					onTarget={changeTarget}
					onCreate={createSession}
					onClose={closeCreate}
				/>
			)}
			{create === "project" && (
				<ProjectDialog
					serverError={ui.error}
					profiles={ui.profiles}
					selectedId={selectedId}
					directory={connected ? ui.directory : null}
					connected={
						connected &&
						Boolean(
							ui.connection?.capabilities?.projects &&
								ui.connection?.capabilities?.durableOperations,
						)
					}
					busy={disabled}
					onTarget={changeTarget}
					onBrowse={(path) => void browse(path)}
					onImport={() => {
						if (ui.directory)
							void projectMutation({
								operationId: crypto.randomUUID(),
								name:
									ui.directory.path.split("/").filter(Boolean).at(-1) ||
									"Project",
								mode: { kind: "importLocal", repoPath: ui.directory.path },
							});
					}}
					onCreate={async (input) => {
						await projectMutation(input);
					}}
					onClose={closeCreate}
				/>
			)}
			{remove && (
				<WorkstationDialog
					title={t({ message: "Remove" })}
					onClose={() => setRemove(null)}
				>
					<div className="ws-dialog-body">
						<h3>{remove.name}</h3>
						<p className="ws-description">
							<Trans>
								Remove this device's connection settings. Remote files and tasks
								are kept.
							</Trans>
						</p>
					</div>
					<div className="ws-dialog-footer">
						<button
							type="button"
							className="ws-button"
							disabled={disabled}
							onClick={() => setRemove(null)}
						>
							<Trans>Cancel</Trans>
						</button>
						<button
							type="button"
							className="ws-button danger"
							disabled={disabled}
							onClick={() =>
								void (async () => {
									if (await ui.removeProfile(remove)) setRemove(null);
								})()
							}
						>
							<Trans>Remove</Trans>
						</button>
					</div>
				</WorkstationDialog>
			)}
		</WorkstationShell>
	);
}

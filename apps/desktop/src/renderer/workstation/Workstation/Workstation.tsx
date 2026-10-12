import { Trans, useLingui } from "@lingui/react/macro";
import { useCallback, useEffect, useRef, useState } from "react";
import type {
	DirectDescriptor,
	DirectLocalNamespace,
	DirectProfile,
	DirectWorkstationApi,
} from "../../../shared/direct-workstation";
import { LocalDataPanel } from "./components/LocalDataPanel";
import { RemoteChat } from "./components/RemoteChat/RemoteChat";
import { RemoteFiles } from "./components/RemoteFiles/RemoteFiles";
import { RemoteProjectCreator } from "./components/RemoteProjectCreator/RemoteProjectCreator";
import { RemoteTerminal } from "./components/RemoteTerminal/RemoteTerminal";

interface RemoteWorkspace {
	id: string;
	name: string;
	worktreePath: string;
}
interface RemoteProject {
	id: string;
	name: string;
	repoPath: string;
}
interface RemoteDirectory {
	path: string;
	parentPath: string | null;
	entries: { name: string; isDirectory: boolean; isSymlink: boolean }[];
}

const field =
	"rounded border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm min-w-0";
const button =
	"rounded border border-zinc-700 px-3 py-2 text-sm hover:bg-zinc-800 disabled:opacity-40";
const sshCommand = "ssh";

export function Workstation({
	api = window.directWorkstation,
}: {
	api?: DirectWorkstationApi;
}) {
	const { t } = useLingui();
	const [profiles, setProfiles] = useState<DirectProfile[]>([]);
	const [connection, setConnection] = useState<DirectDescriptor | null>(null);
	const [projects, setProjects] = useState<RemoteProject[]>([]);
	const [workspaces, setWorkspaces] = useState<RemoteWorkspace[]>([]);
	const [workspaceId, setWorkspaceId] = useState<string | null>(null);
	const [terminalIds, setTerminalIds] = useState<string[]>([]);
	const [terminalId, setTerminalId] = useState<string | null>(null);
	const [directory, setDirectory] = useState<RemoteDirectory | null>(null);
	const [busy, setBusy] = useState(false);
	const [reconnecting, setReconnecting] = useState<
		false | "reconnecting" | "blocked"
	>(false);
	const [error, setError] = useState<string | null>(null);
	const [notice, setNotice] = useState<string | null>(null);
	const [forward, setForward] = useState<{ id: string; url: string } | null>(
		null,
	);
	const [pending, setPending] = useState<
		{ operationId: string; procedure: string; status: string }[]
	>([]);
	const procedureLabel = (procedure: string) =>
		(
			({
				"project.create": t({ message: "Create project" }),
				"workspaceCreation.createSession": t({ message: "New session" }),
				"workspaces.create": t({ message: "New session" }),
				"terminal.createSession": t({ message: "New terminal" }),
				"chat.createSession": t({ message: "New chat" }),
				"chat.prompt": t({ message: "Send message" }),
			}) as Record<string, string>
		)[procedure] ?? t({ message: "Action" });
	const statusLabel = (status: string) =>
		(
			({
				accepted: t({ message: "In progress" }),
				completed: t({ message: "Completed" }),
				failed: t({ message: "Failed" }),
				unresolved: t({ message: "Unresolved" }),
				not_received: t({ message: "Not sent" }),
			}) as Record<string, string>
		)[status] ?? t({ message: "Unknown" });
	const active = useRef<DirectDescriptor | null>(null);
	const localSelection = useRef<{
		profileId: string;
		backendId: string;
		namespaceId: string;
		epoch: number;
	} | null>(null);
	const selectedWorkspace = useRef<string | null>(null);
	const password = useRef<HTMLInputElement>(null);
	const operation = async (execute: () => Promise<void>) => {
		setBusy(true);
		setError(null);
		setNotice(null);
		try {
			await execute();
		} catch (error) {
			setError(error instanceof Error ? error.message : String(error));
		} finally {
			setBusy(false);
		}
	};
	const rpc = useCallback(
		<T,>(
			path: string,
			type: "query" | "mutation",
			input?: unknown,
			target = active.current,
		) => {
			if (!target)
				return Promise.reject(
					new Error(t({ message: "Connect to a machine first" })),
				);
			return api.rpc<T>({
				connectionId: target.connectionId,
				generation: target.generation,
				path,
				type,
				input,
			});
		},
		[api, t],
	);
	const refresh = useCallback(
		async (target = active.current, recheckFeatures = false) => {
			if (!target) return;
			const [nextProjects, nextWorkspaces] = await Promise.all([
				rpc<RemoteProject[]>("project.list", "query", undefined, target),
				rpc<RemoteWorkspace[]>("workspace.list", "query", undefined, target),
			]);
			if (
				active.current?.connectionId === target.connectionId &&
				active.current.generation === target.generation
			) {
				setProjects(nextProjects);
				setWorkspaces(nextWorkspaces);
			}
			if (recheckFeatures) {
				const descriptor = await api.refreshFeatures(target);
				if (
					active.current?.connectionId === target.connectionId &&
					active.current.generation === target.generation
				) {
					active.current = descriptor;
					setConnection(descriptor);
				}
			}
		},
		[api, rpc],
	);
	const selectWorkspace = async (id: string) => {
		const target = active.current;
		selectedWorkspace.current = id;
		setWorkspaceId(id);
		setTerminalId(null);
		setTerminalIds([]);
		const { sessions } = await rpc<{ sessions: { terminalId: string }[] }>(
			"terminal.list",
			"query",
			{ workspaceId: id },
		);
		if (active.current !== target || selectedWorkspace.current !== id) return;
		setTerminalIds(sessions.map((session) => session.terminalId));
		setTerminalId(sessions[0]?.terminalId ?? null);
	};
	useEffect(() => {
		void api
			.list()
			.then(setProfiles)
			.catch((error) => setError(String(error)));
	}, [api]);
	useEffect(
		() =>
			api.onConnection?.((event) => {
				const current = active.current;
				if (
					!current ||
					current.connectionId !== event.connectionId ||
					current.generation !== event.previousGeneration
				)
					return;
				if (event.kind === "connected") {
					if (
						event.descriptor.backendId !== current.backendId ||
						event.descriptor.namespaceId !== current.namespaceId ||
						event.descriptor.generation <= current.generation
					)
						return;
					active.current = event.descriptor;
					setConnection(event.descriptor);
					setReconnecting(false);
					setError(null);
					setForward(null);
					void refresh(event.descriptor).catch((error) => {
						if (active.current === event.descriptor) setError(String(error));
					});
				} else {
					setReconnecting(event.kind);
					setForward(null);
					if (event.kind === "blocked") setError(event.error);
				}
			}),
		[api, refresh],
	);
	const addConnection = (form: HTMLFormElement) =>
		operation(async () => {
			const input = new FormData(form);
			const saved = await api.save({
				id: crypto.randomUUID(),
				name: String(input.get("name")),
				host: String(input.get("host")),
				...(input.get("user") ? { user: String(input.get("user")) } : {}),
				...(input.get("port") ? { port: Number(input.get("port")) } : {}),
				...(input.get("identity")
					? { identityFile: String(input.get("identity")) }
					: {}),
			});
			setProfiles((previous) => [...previous, saved]);
			form.reset();
		});
	const namespaceSelected = (
		profileId: string,
		namespace: DirectLocalNamespace,
	) => {
		const previous = localSelection.current;
		const sameIdentity =
			previous?.profileId === profileId &&
			previous.backendId === namespace.backendId &&
			previous.namespaceId === namespace.namespaceId;
		localSelection.current = {
			profileId,
			backendId: namespace.backendId,
			namespaceId: namespace.namespaceId,
			epoch: previous ? previous.epoch + (sameIdentity ? 0 : 1) : 0,
		};
		const current = active.current;
		if (
			!current ||
			current.connectionId !== profileId ||
			(current.namespaceId === namespace.namespaceId &&
				current.backendId === namespace.backendId)
		)
			return;
		active.current = null;
		selectedWorkspace.current = null;
		setConnection(null);
		setReconnecting(false);
		setWorkspaceId(null);
		setTerminalId(null);
		setTerminalIds([]);
		setProjects([]);
		setWorkspaces([]);
		setDirectory(null);
		setForward(null);
		setPending([]);
	};
	const connect = (profile: DirectProfile) =>
		operation(async () => {
			const selectionEpoch = localSelection.current?.epoch ?? 0;
			const selectionIsCurrent = () =>
				profile.kind !== "local" ||
				(localSelection.current?.epoch ?? 0) === selectionEpoch;
			const oneTimePassword = password.current?.value || undefined;
			if (password.current) password.current.value = "";
			if (active.current) await api.disconnect(active.current.connectionId);
			if (!selectionIsCurrent()) return;
			active.current = null;
			setReconnecting(false);
			selectedWorkspace.current = null;
			setConnection(null);
			setWorkspaceId(null);
			setTerminalId(null);
			setTerminalIds([]);
			setDirectory(null);
			setProjects([]);
			setWorkspaces([]);
			setForward(null);
			setPending([]);
			let descriptor: DirectDescriptor;
			try {
				descriptor = await api.connect(profile.id, oneTimePassword);
			} catch (error) {
				if (!selectionIsCurrent()) return;
				throw error;
			}
			if (!selectionIsCurrent()) return;
			const selected = localSelection.current;
			if (
				profile.kind === "local" &&
				selected &&
				(selected.profileId !== descriptor.connectionId ||
					selected.backendId !== descriptor.backendId ||
					selected.namespaceId !== descriptor.namespaceId)
			)
				return;
			active.current = descriptor;
			setConnection(descriptor);
			await refresh(descriptor);
		});
	const disconnect = () =>
		operation(async () => {
			if (active.current) await api.disconnect(active.current.connectionId);
			active.current = null;
			setReconnecting(false);
			selectedWorkspace.current = null;
			setConnection(null);
			setWorkspaceId(null);
			setTerminalId(null);
			setTerminalIds([]);
			setDirectory(null);
			setProjects([]);
			setWorkspaces([]);
			setForward(null);
			setPending([]);
		});
	const control = (
		profile: DirectProfile,
		action: "install" | "activate" | "start" | "stop" | "repair" | "uninstall",
	) =>
		operation(async () => {
			const oneTimePassword = password.current?.value || undefined;
			if (password.current) password.current.value = "";
			const result = await api.control(profile.id, action, oneTimePassword);
			setNotice(JSON.stringify(result));
			if (
				result &&
				typeof result === "object" &&
				"status" in result &&
				result.status === "cancelled"
			)
				return;
			if (action !== "install" && active.current?.connectionId === profile.id) {
				active.current = null;
				setReconnecting(false);
				selectedWorkspace.current = null;
				setConnection(null);
				setWorkspaceId(null);
				setTerminalId(null);
				setTerminalIds([]);
				setDirectory(null);
				setProjects([]);
				setWorkspaces([]);
				setForward(null);
				setPending([]);
			}
		});
	return (
		<main className="h-screen overflow-auto bg-zinc-950 text-zinc-100 pt-10 px-6 pb-6">
			<h1 className="text-2xl font-semibold mb-2">
				<Trans>SSH workstation</Trans>
			</h1>
			<p className="text-sm text-zinc-400 mb-5">
				<Trans>
					Connect directly to your machine. Agents keep running when this app
					closes.
				</Trans>
			</p>
			<p className="text-xs text-zinc-400 mb-4">
				<Trans>
					Before the first SSH connection, run SSH in your system terminal and
					verify the host fingerprint.
				</Trans>
			</p>
			{api.platform === "win32" && (
				<output className="block text-sm text-amber-300 mb-4">
					<Trans>Windows connections are not supported yet.</Trans>
				</output>
			)}
			{error && (
				<p
					role="alert"
					className="rounded bg-red-950 p-3 mb-4 whitespace-pre-wrap"
				>
					{error}
				</p>
			)}
			{notice && (
				<output className="block rounded bg-zinc-800 p-3 mb-4 whitespace-pre-wrap">
					{notice}
				</output>
			)}
			{reconnecting && (
				<output className="block rounded bg-zinc-800 p-3 mb-4">
					{reconnecting === "blocked" ? (
						<Trans>Disconnected</Trans>
					) : (
						<Trans>Reconnecting</Trans>
					)}
				</output>
			)}
			<div className="grid grid-cols-[280px_1fr] gap-6">
				<aside className="min-w-0 space-y-5">
					<form
						className="grid gap-2"
						onSubmit={(event) => {
							event.preventDefault();
							void addConnection(event.currentTarget);
						}}
					>
						<label className="grid gap-1">
							<Trans>Name</Trans>
							<input className={field} name="name" required maxLength={100} />
						</label>
						<label className="grid gap-1">
							<Trans>SSH host</Trans>
							<input
								className={field}
								name="host"
								required
								placeholder={t({ message: "SSH host" })}
							/>
						</label>
						<label className="grid gap-1">
							<Trans>SSH user</Trans>
							<input className={field} name="user" autoComplete="off" />
						</label>
						<label className="grid gap-1">
							<Trans>Port</Trans>
							<input
								className={field}
								name="port"
								type="number"
								min="1"
								max="65535"
								placeholder="22"
							/>
						</label>
						<label className="grid gap-1">
							<Trans>Identity file</Trans>
							<input
								className={field}
								name="identity"
								placeholder={t({ message: "Identity file" })}
							/>
						</label>
						<button className={button} disabled={busy} type="submit">
							<Trans>Add connection</Trans>
						</button>
					</form>
					<label className="grid gap-1 text-sm">
						<Trans>Administrator password</Trans>
						<input
							className={field}
							ref={password}
							type="password"
							autoComplete="off"
						/>
					</label>
					<p className="text-xs text-zinc-400">
						<Trans>
							Optional, used once to install the backend on the remote machine.
						</Trans>
					</p>
					{profiles.map((profile) => (
						<div
							key={profile.id}
							className="rounded border border-zinc-800 p-3 space-y-2"
						>
							<div className="font-medium">
								{profile.kind === "local" ? (
									<Trans>Local Device</Trans>
								) : (
									profile.name
								)}
							</div>
							{profile.kind !== "local" && (
								<code className="block text-xs text-zinc-400 break-all">
									{sshCommand}
									{profile.port ? ` -p ${profile.port}` : ""}
									{profile.identityFile
										? ` -i '${profile.identityFile.replaceAll("'", "'\\''")}'`
										: ""}{" "}
									{profile.user ? `${profile.user}@` : ""}
									{profile.host}
								</code>
							)}
							<div className="flex gap-1 flex-wrap">
								<button
									type="button"
									className={button}
									disabled={busy || api.platform === "win32"}
									onClick={() => void connect(profile)}
								>
									<Trans>Connect</Trans>
								</button>
								<button
									type="button"
									className={button}
									disabled={busy || api.platform === "win32"}
									onClick={() =>
										void operation(async () => {
											const result = await api.test(profile.id);
											setNotice(JSON.stringify(result));
										})
									}
								>
									<Trans>Test connection</Trans>
								</button>
								{profile.kind !== "local" && (
									<>
										<button
											type="button"
											className={button}
											disabled={busy || api.platform === "win32"}
											onClick={() => void control(profile, "repair")}
										>
											<Trans>Repair backend</Trans>
										</button>
										<button
											type="button"
											className={button}
											disabled={busy || api.platform === "win32"}
											onClick={() =>
												void operation(async () => {
													await api.selectRelease(profile.id);
												})
											}
										>
											<Trans>Select backend release</Trans>
										</button>
										<button
											type="button"
											className={button}
											disabled={busy || api.platform === "win32"}
											onClick={() => void control(profile, "install")}
										>
											<Trans>Install</Trans>
										</button>
									</>
								)}
								{profile.kind === "local" && (
									<button
										type="button"
										className={button}
										disabled={
											busy ||
											api.platform === "win32" ||
											connection?.connectionId === profile.id
										}
										onClick={() =>
											void operation(async () => {
												const result = await api.importLocalData(profile.id);
												if (
													result &&
													typeof result === "object" &&
													"status" in result &&
													result.status === "cancelled"
												) {
													setNotice(t({ message: "Cancelled" }));
													return;
												}
												const warnings =
													result &&
													typeof result === "object" &&
													"warnings" in result &&
													Array.isArray(result.warnings)
														? result.warnings
																.filter(
																	(value): value is string =>
																		typeof value === "string",
																)
																.slice(0, 10)
																.map((value) => value.slice(0, 512))
														: [];
												setNotice(
													[
														t({
															message:
																"Local data imported. Start the backend to use it.",
														}),
														...warnings,
													].join("\n\n"),
												);
											})
										}
									>
										<Trans>Import local data</Trans>
									</button>
								)}
								<button
									type="button"
									className={button}
									disabled={busy || api.platform === "win32"}
									onClick={() => void control(profile, "start")}
								>
									<Trans>Start</Trans>
								</button>
								<button
									type="button"
									className={button}
									disabled={busy || api.platform === "win32"}
									onClick={() => void control(profile, "stop")}
								>
									<Trans>Stop</Trans>
								</button>
								{profile.kind !== "local" && (
									<>
										<button
											type="button"
											className={button}
											disabled={busy || api.platform === "win32"}
											onClick={() => void control(profile, "activate")}
										>
											<Trans>Update</Trans>
										</button>
										<button
											type="button"
											className={button}
											disabled={busy || api.platform === "win32"}
											onClick={() => void control(profile, "uninstall")}
										>
											<Trans>Uninstall backend</Trans>
										</button>
										<button
											type="button"
											className={button}
											disabled={busy || connection?.connectionId === profile.id}
											onClick={() =>
												void operation(async () => {
													await api.remove(profile.id);
													setProfiles(await api.list());
												})
											}
										>
											<Trans>Remove</Trans>
										</button>
									</>
								)}
							</div>
							{profile.kind === "local" && (
								<p className="text-xs text-zinc-400">
									<Trans>
										For folder import, stop the selected backend first, then
										start it after import.
									</Trans>{" "}
									<Trans>
										Choose the legacy .superset folder for v1 data, or a single
										organization folder inside .superset/host for v2 data.
									</Trans>
								</p>
							)}
							{profile.kind === "local" &&
								api.localData &&
								api.platform !== "win32" && (
									<LocalDataPanel
										api={api.localData}
										onError={setError}
										onNamespaceSelected={(namespace) =>
											namespaceSelected(profile.id, namespace)
										}
									/>
								)}
						</div>
					))}
					{connection && (
						<button
							type="button"
							className={button}
							disabled={busy}
							onClick={() => void disconnect()}
						>
							<Trans>Disconnect</Trans>
						</button>
					)}
				</aside>
				<section className="min-w-0 space-y-4">
					{connection && (
						<fieldset disabled={Boolean(reconnecting)} className="space-y-4">
							<div className="flex gap-2 flex-wrap">
								<button
									type="button"
									className={button}
									disabled={busy}
									onClick={() =>
										void operation(async () => {
											await refresh(active.current, true);
										})
									}
								>
									<Trans>Refresh</Trans>
								</button>
								<button
									type="button"
									className={button}
									disabled={busy}
									onClick={() =>
										void operation(async () => {
											const target = active.current;
											if (!target) return;
											const results = await api.reconcile(target.connectionId);
											if (active.current !== target) return;
											setPending(
												results as {
													operationId: string;
													procedure: string;
													status: string;
												}[],
											);
											setNotice(
												results.length
													? null
													: t({ message: "No pending actions." }),
											);
											await refresh(target);
										})
									}
								>
									<Trans>Check pending action</Trans>
								</button>
								<button
									type="button"
									className={button}
									disabled={
										busy ||
										!connection.capabilities?.projects ||
										!connection.capabilities?.durableOperations
									}
									onClick={() =>
										void operation(async () => {
											setDirectory(
												await rpc("filesystem.browseHost", "query", {}),
											);
										})
									}
								>
									<Trans>Add project</Trans>
								</button>
								<button
									type="button"
									className={button}
									disabled={
										busy ||
										!connection.capabilities?.sessions ||
										!connection.capabilities?.durableOperations
									}
									onClick={() =>
										void operation(async () => {
											const result = await rpc<{ workspace: RemoteWorkspace }>(
												"workspaces.createSession",
												"mutation",
												{
													id: crypto.randomUUID(),
													operationId: crypto.randomUUID(),
												},
											);
											await refresh();
											await selectWorkspace(result.workspace.id);
										})
									}
								>
									<Trans>New session</Trans>
								</button>
							</div>
							{pending.length > 0 && (
								<ul className="space-y-2 rounded border border-zinc-700 p-3">
									{pending.map((action) => (
										<li
											key={action.operationId}
											className="flex flex-wrap items-center gap-3 text-sm"
										>
											<span>{procedureLabel(action.procedure)}</span>
											<span>{statusLabel(action.status)}</span>
											{action.status === "unresolved" && (
												<button
													type="button"
													className={button}
													disabled={busy}
													onClick={() =>
														void operation(async () => {
															const target = active.current;
															if (!target) return;
															const acknowledged = await api.acknowledge(
																target,
																action.operationId,
															);
															if (active.current !== target) return;
															if (acknowledged)
																setPending((items) =>
																	items.filter(
																		(item) =>
																			item.operationId !== action.operationId,
																	),
																);
															else setNotice(t({ message: "Cancelled" }));
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
							{directory && (
								<div className="rounded border border-zinc-700 p-3 space-y-2">
									<code className="block text-sm break-all">
										{directory.path}
									</code>
									<form
										key={directory.path}
										className="flex gap-2"
										onSubmit={(event) => {
											event.preventDefault();
											const path = String(
												new FormData(event.currentTarget).get("path"),
											);
											void operation(async () => {
												setDirectory(
													await rpc("filesystem.browseHost", "query", { path }),
												);
											});
										}}
									>
										<label className="grid gap-1 flex-1">
											<Trans>Path</Trans>
											<input
												className={field}
												name="path"
												defaultValue={directory.path}
												required
											/>
										</label>
										<button className={button} type="submit" disabled={busy}>
											<Trans>Open</Trans>
										</button>
									</form>
									<div className="flex gap-2 flex-wrap">
										{directory.parentPath && (
											<button
												type="button"
												className={button}
												onClick={() =>
													void operation(async () => {
														setDirectory(
															await rpc("filesystem.browseHost", "query", {
																path: directory.parentPath,
															}),
														);
													})
												}
											>
												..
											</button>
										)}
										{directory.entries
											.filter((entry) => entry.isDirectory || entry.isSymlink)
											.map((entry) => (
												<button
													type="button"
													className={button}
													key={entry.name}
													onClick={() =>
														void operation(async () => {
															setDirectory(
																await rpc("filesystem.browseHost", "query", {
																	path: `${directory.path}/${entry.name}`,
																}),
															);
														})
													}
												>
													{entry.name}/
												</button>
											))}
									</div>
									<button
										type="button"
										className={button}
										disabled={
											busy || !connection.capabilities?.durableOperations
										}
										onClick={() =>
											void operation(async () => {
												await rpc("project.create", "mutation", {
													operationId: crypto.randomUUID(),
													name:
														directory.path.split("/").filter(Boolean).at(-1) ||
														"Project",
													mode: {
														kind: "importLocal",
														repoPath: directory.path,
													},
												});
												setDirectory(null);
												await refresh();
											})
										}
									>
										<Trans>Import this repository</Trans>
									</button>
									<RemoteProjectCreator
										parentDir={directory.path}
										busy={busy}
										disabled={!connection.capabilities?.durableOperations}
										onCreate={(input) =>
											operation(async () => {
												await rpc("project.create", "mutation", input);
												setDirectory(null);
												await refresh();
											})
										}
									/>
								</div>
							)}
							<div className="flex gap-2 flex-wrap">
								{projects.map((project) => (
									<button
										type="button"
										key={project.id}
										className={button}
										disabled={
											busy || !connection.capabilities?.durableOperations
										}
										onClick={() =>
											void operation(async () => {
												const result = await rpc<{
													workspace: RemoteWorkspace;
												}>("workspaces.create", "mutation", {
													id: crypto.randomUUID(),
													operationId: crypto.randomUUID(),
													projectId: project.id,
													checkout: "local",
													runSetup: false,
												});
												await refresh();
												await selectWorkspace(result.workspace.id);
											})
										}
									>
										{project.name}
									</button>
								))}
							</div>
							<div className="flex gap-2 flex-wrap">
								{workspaces.map((workspace) => (
									<button
										type="button"
										key={workspace.id}
										className={`${button} ${workspaceId === workspace.id ? "bg-zinc-700" : ""}`}
										disabled={busy}
										onClick={() =>
											void operation(() => selectWorkspace(workspace.id))
										}
									>
										{workspace.name}
									</button>
								))}
							</div>
							{workspaceId && (
								<>
									<p className="text-xs text-zinc-400 break-all">
										{
											workspaces.find(
												(workspace) => workspace.id === workspaceId,
											)?.worktreePath
										}
									</p>
									<div className="flex gap-2 flex-wrap">
										{terminalIds.map((id, index) => (
											<button
												type="button"
												key={id}
												className={button}
												onClick={() => setTerminalId(id)}
											>
												#{index + 1}
											</button>
										))}
										<button
											type="button"
											className={button}
											disabled={
												busy ||
												!connection.capabilities?.terminals ||
												!connection.capabilities?.durableOperations
											}
											onClick={() =>
												void operation(async () => {
													const id = crypto.randomUUID();
													await rpc("terminal.createSession", "mutation", {
														workspaceId,
														terminalId: id,
														operationId: crypto.randomUUID(),
													});
													setTerminalIds((previous) => [...previous, id]);
													setTerminalId(id);
												})
											}
										>
											<Trans>New terminal</Trans>
										</button>
									</div>
									{terminalId && (
										<RemoteTerminal
											key={`${connection.generation}:${terminalId}`}
											api={api}
											connection={connection}
											terminalId={terminalId}
											onError={setError}
										/>
									)}
									{connection.capabilities?.chat && (
										<RemoteChat
											key={`chat:${workspaceId}`}
											api={api}
											connection={connection}
											workspaceId={workspaceId}
											onError={setError}
										/>
									)}
									{connection.capabilities?.files && (
										<RemoteFiles
											key={`files:${connection.generation}:${workspaceId}`}
											api={api}
											connection={connection}
											workspaceId={workspaceId}
											onError={setError}
										/>
									)}
									<form
										className="flex gap-2"
										onSubmit={(event) => {
											event.preventDefault();
											const port = Number(
												new FormData(event.currentTarget).get("port"),
											);
											void operation(async () => {
												if (forward) {
													await api.closePort(forward.id);
													setForward(null);
												}
												setForward(
													await api.openPort(connection, workspaceId, port),
												);
											});
										}}
									>
										<label>
											<Trans>Port</Trans>
											<input
												className={field}
												type="number"
												name="port"
												min="1"
												max="65535"
												required
											/>
										</label>
										<button type="submit" className={button} disabled={busy}>
											<Trans>Open port</Trans>
										</button>
									</form>
									{forward && (
										<div className="flex gap-2">
											<code>{forward.url}</code>
											<button
												type="button"
												className={button}
												onClick={() =>
													void operation(async () => {
														await api.closePort(forward.id);
														setForward(null);
													})
												}
											>
												<Trans>Close</Trans>
											</button>
										</div>
									)}
								</>
							)}
						</fieldset>
					)}
				</section>
			</div>
		</main>
	);
}

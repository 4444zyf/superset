import { Trans, useLingui } from "@lingui/react/macro";
import type {
	HostTerminalPreset,
	HostTerminalPresetCatalog,
} from "@superset/host-service/settings";
import { errorMessage } from "@superset/i18n/errors";
import { Button } from "@superset/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@superset/ui/dialog";
import {
	useCallback,
	useContext,
	useEffect,
	useId,
	useRef,
	useState,
} from "react";
import {
	findLinkedAgent,
	getAgentCommandText,
	resolvePresetLaunchCommands,
} from "renderer/lib/agent-launch-command";
import { createDefaultV2TerminalPresetRows } from "renderer/routes/_authenticated/components/AgentHooks/hooks/useDefaultV2TerminalPresets/default-v2-terminal-presets";
import { PresetEditorDialogView } from "renderer/routes/_authenticated/settings/terminal/components/TerminalSettings/components/PresetsSection/components/PresetEditorDialog/components/PresetEditorDialogView/PresetEditorDialogView";
import { toPresetDirectoryValue } from "renderer/routes/_authenticated/settings/terminal/components/TerminalSettings/components/PresetsSection/components/PresetEditorDialog/preset-directory-value";
import { PresetsTableView } from "renderer/routes/_authenticated/settings/terminal/components/TerminalSettings/components/PresetsSection/components/PresetsTable/components/PresetsTableView/PresetsTableView";
import type { PresetProjectOption } from "renderer/routes/_authenticated/settings/terminal/components/TerminalSettings/components/PresetsSection/preset-project-options";
import { UnsavedChangesDialog } from "renderer/screens/main/components/WorkspaceView/ContentView/TabsContent/TabView/FileViewerPane/UnsavedChangesDialog";
import { toAbsoluteWorkspacePath } from "shared/absolute-paths";
import { WorkstationEditorGuardsContext } from "../../../../providers/WorkstationEditorGuards/workstation-editor-guards";
import { useWorkstationAppearance } from "../../../../providers/WorkstationPreferencesContext/WorkstationPreferencesContext";
import type { RemoteDirectory } from "../../../../types";
import { RemoteAgentSettings } from "../../../RemoteAgentSettings/RemoteAgentSettings";
import { RemoteDirectoryBrowser } from "../../../RemoteDirectoryBrowser/RemoteDirectoryBrowser";

import type { RemoteTerminalScriptsProps as Props } from "../../remote-terminal-scripts-types";

type Change =
	| { kind: "initialize"; presets: HostTerminalPreset[] }
	| { kind: "add"; preset: HostTerminalPreset }
	| { kind: "update"; id: string; patch: Partial<HostTerminalPreset> }
	| { kind: "remove"; id: string }
	| { kind: "reorder"; ids: string[] };
const fieldsOf = (p: HostTerminalPreset) => ({
	name: p.name,
	description: p.description,
	cwd: p.cwd,
	commands: p.commands,
	projectIds: p.projectIds,
	pinnedToBar: p.pinnedToBar,
	useAsWorkspaceRun: p.useAsWorkspaceRun,
	applyOnWorkspaceCreated: p.applyOnWorkspaceCreated,
	applyOnNewTab: p.applyOnNewTab,
	executionMode: p.executionMode,
	agentId: p.agentId,
});
const sameFields = (a: HostTerminalPreset, b: HostTerminalPreset) =>
	JSON.stringify(fieldsOf(a)) === JSON.stringify(fieldsOf(b));

export function RemoteTerminalScriptsView({
	api,
	connection,
	workspaceId,
	agents,
	busy,
	onCatalogChanged,
	onAgentChanged,
	configurationRequest,
}: Props) {
	const changed = useRef(onCatalogChanged);
	changed.current = onCatalogChanged;
	const { t } = useLingui();
	const { theme } = useWorkstationAppearance();
	const registry = useContext(WorkstationEditorGuardsContext),
		guardId = useId();
	const alive = useRef(false),
		pending = useRef(false),
		blocked = useRef(false),
		errorRef = useRef<string | null>(null);
	const [catalog, setCatalog] = useState<HostTerminalPresetCatalog | null>(
			null,
		),
		catalogRef = useRef(catalog);
	catalogRef.current = catalog;
	const [draft, setDraft] = useState<HostTerminalPreset | null>(null),
		draftRef = useRef(draft);
	draftRef.current = draft;
	const [open, setOpen] = useState(false),
		[working, setWorking] = useState(false),
		[error, setErrorState] = useState<string | null>(null),
		[saved, setSaved] = useState(false),
		[confirm, setConfirm] = useState<"reload" | "close" | "delete" | null>(
			null,
		);
	const [projects, setProjects] = useState<PresetProjectOption[]>([]),
		[preferredProjectId, setPreferredProjectId] = useState<string | null>(null);
	const [localOrder, setLocalOrder] = useState<string[] | null>(null);
	const handledConfiguration = useRef<string | null>(null);
	useEffect(() => {
		if (
			!configurationRequest ||
			handledConfiguration.current === configurationRequest.requestId ||
			!catalog ||
			working
		)
			return;
		handledConfiguration.current = configurationRequest.requestId;
		setOpen(true);
		if (draftRef.current || !configurationRequest.presetId) return;
		const selected = catalog.presets.find(
			(p) => p.id === configurationRequest.presetId,
		);
		if (selected) {
			draftRef.current = selected;
			setDraft(selected);
		}
	}, [configurationRequest, catalog, working]);
	const container = useRef<HTMLDivElement>(null);
	const [workspacePath, setWorkspacePath] = useState<string | null>(null);
	const [directoryOpen, setDirectoryOpen] = useState(false),
		[directory, setDirectory] = useState<RemoteDirectory | null>(null),
		[directoryBusy, setDirectoryBusy] = useState(false),
		[directoryError, setDirectoryError] = useState<string | null>(null);
	const browseEpoch = useRef(0);
	const [editingAgentId, setEditingAgentId] = useState<string | null>(null);

	const rpc = useCallback(
		<T,>(path: string, type: "query" | "mutation", input?: unknown) =>
			api.rpc<T>({
				connectionId: connection.connectionId,
				generation: connection.generation,
				path,
				type,
				input,
			}),
		[api, connection.connectionId, connection.generation],
	);
	const read = useCallback(
		() =>
			rpc<HostTerminalPresetCatalog>(
				"settings.terminalPresets.catalogWithRevisionV1",
				"query",
			),
		[rpc],
	);
	const setError = useCallback(
		(value: string | null) => {
			errorRef.current = value;
			setErrorState(value);
			registry?.changed();
		},
		[registry],
	);
	const setPending = useCallback(
		(value: boolean) => {
			pending.current = value;
			setWorking(value);
			registry?.changed();
		},
		[registry],
	);
	const seed = useRef({ agents, t });
	const isDirty = () => {
		const d = draftRef.current;
		if (!d) return false;
		const base = catalogRef.current?.presets.find((p) => p.id === d.id);
		return !base || !sameFields(base, d);
	};
	const acknowledge = (value: HostTerminalPresetCatalog) => {
		catalogRef.current = value;
		setCatalog(value);
		changed.current?.(value);
		blocked.current = false;
		setError(null);
		setSaved(true);
		setLocalOrder(null);
		registry?.changed();
	};
	const matches = (value: HostTerminalPresetCatalog, change: Change) => {
		if (change.kind === "remove")
			return !value.presets.some((p) => p.id === change.id);
		if (change.kind === "reorder")
			return (
				JSON.stringify(value.presets.map((p) => p.id)) ===
				JSON.stringify(change.ids)
			);
		if (change.kind === "initialize")
			return (
				value.initialized &&
				value.presets.length === change.presets.length &&
				value.presets.every((p, i) =>
					Boolean(
						change.presets[i] &&
							p.id === change.presets[i]?.id &&
							sameFields(p, change.presets[i]),
					),
				)
			);
		const base =
			change.kind === "update"
				? catalogRef.current?.presets.find((p) => p.id === change.id)
				: undefined;
		if (change.kind === "update" && !base) return false;
		const desired =
			change.kind === "add"
				? change.preset
				: ({ ...base, ...change.patch } as HostTerminalPreset);
		const row = value.presets.find((p) => p.id === desired.id);
		return !!row && sameFields(row, desired);
	};
	const mutate = async (change: Change) => {
		const before = catalogRef.current;
		if (!before || pending.current || blocked.current) return false;
		setPending(true);
		setSaved(false);
		setError(null);
		try {
			const value = await rpc<HostTerminalPresetCatalog>(
				"settings.terminalPresets.applyCatalogChangeV1",
				"mutation",
				{ expectedRevision: before.revision, change },
			);
			if (!alive.current) return false;
			acknowledge(value);
			return true;
		} catch {
			if (!alive.current) return false;
			try {
				const value = await read();
				if (!alive.current) return false;
				if (matches(value, change)) {
					acknowledge(value);
					return true;
				}
			} catch {}
			if (alive.current) {
				blocked.current = true;
				setError(
					t({ message: "This configuration changed. Reload before saving." }),
				);
			}
			return false;
		} finally {
			if (alive.current) setPending(false);
		}
	};
	const save = async () => {
		if (pending.current || blocked.current) return false;
		const d = draftRef.current;
		if (!d || !isDirty()) {
			setSaved(true);
			return true;
		}
		const base = catalogRef.current?.presets.find((p) => p.id === d.id);
		return mutate(
			base
				? { kind: "update", id: d.id, patch: fieldsOf(d) }
				: { kind: "add", preset: d },
		);
	};
	const saveRef = useRef(save);
	saveRef.current = save;
	const dirtyRef = useRef(isDirty);
	dirtyRef.current = isDirty;
	useEffect(
		() =>
			registry?.register({
				id: guardId,
				label: () =>
					draftRef.current?.name || t({ message: "Terminal Scripts" }),
				isDirty: () => dirtyRef.current(),
				isPending: () => pending.current,
				getError: () => errorRef.current,
				save: () => saveRef.current(),
			}),
		[registry, guardId, t],
	);
	const loadEpoch = useRef(0);
	const loadCatalog = useCallback(
		async (epoch: number) => {
			let value = await read();
			if (!alive.current || loadEpoch.current !== epoch) return null;
			if (!value.initialized) {
				const presets = createDefaultV2TerminalPresetRows({
					agents: seed.current.agents,
					existingPresets: [],
					createId: () => crypto.randomUUID(),
					createdAt: new Date(),
				});
				try {
					value = await rpc<HostTerminalPresetCatalog>(
						"settings.terminalPresets.applyCatalogChangeV1",
						"mutation",
						{
							expectedRevision: value.revision,
							change: { kind: "initialize", presets },
						},
					);
				} catch {
					value = await read();
					if (!value.initialized)
						throw new Error(seed.current.t({ message: "Failed to save" }));
				}
			}
			return alive.current && loadEpoch.current === epoch ? value : null;
		},
		[read, rpc],
	);
	useEffect(() => {
		alive.current = true;
		const epoch = ++loadEpoch.current;
		setPending(true);
		void loadCatalog(epoch)
			.then((value) => {
				if (value) {
					catalogRef.current = value;
					setCatalog(value);
					changed.current?.(value);
				}
			})
			.catch((e) => {
				if (alive.current && loadEpoch.current === epoch)
					setError(errorMessage(e));
			})
			.finally(() => {
				if (alive.current && loadEpoch.current === epoch) setPending(false);
			});
		return () => {
			alive.current = false;
			loadEpoch.current++;
		};
	}, [loadCatalog, setError, setPending]);

	useEffect(() => {
		if (!open) return;
		let active = true;
		void Promise.all([
			rpc<{ id: string; name: string; repoPath: string }[]>(
				"project.list",
				"query",
			),
			rpc<{ projectId: string; worktreePath: string }>(
				"workspace.get",
				"query",
				{ id: workspaceId },
			),
		])
			.then(([rows, w]) => {
				if (active) {
					setProjects(
						rows.map((p) => ({
							id: p.id,
							name: p.name,
							color: "",
							mainRepoPath: p.repoPath,
						})),
					);
					setPreferredProjectId(w.projectId);
					setWorkspacePath(w.worktreePath);
				}
			})
			.catch((e) => {
				if (active) setError(errorMessage(e));
			});
		return () => {
			active = false;
		};
	}, [open, rpc, setError, workspaceId]);
	const changeDraft = (patch: Partial<HostTerminalPreset>) => {
		if (pending.current || !draftRef.current) return;
		const value = { ...draftRef.current, ...patch };
		draftRef.current = value;
		setDraft(value);
		setSaved(false);
		registry?.changed();
	};

	const browseDirectory = async (path?: string) => {
		const epoch = ++browseEpoch.current;
		setDirectoryBusy(true);
		setDirectoryError(null);
		setDirectoryOpen(true);
		try {
			const result = await rpc<RemoteDirectory>(
				"filesystem.browseHost",
				"query",
				path ? { path } : {},
			);
			if (alive.current && browseEpoch.current === epoch) setDirectory(result);
		} catch (e) {
			if (alive.current && browseEpoch.current === epoch)
				setDirectoryError(errorMessage(e));
		} finally {
			if (alive.current && browseEpoch.current === epoch)
				setDirectoryBusy(false);
		}
	};
	const closeDirectory = () => {
		browseEpoch.current++;
		setDirectoryOpen(false);
		setDirectoryBusy(false);
	};
	const finishEditor = () => {
		draftRef.current = null;
		setDraft(null);
		setConfirm(null);
		setSaved(false);
		registry?.changed();
	};
	const closeEditor = () => {
		if (pending.current) return;
		if (isDirty()) setConfirm("close");
		else finishEditor();
	};
	const refresh = async () => {
		if (pending.current) return;
		setPending(true);
		try {
			const value = await loadCatalog(++loadEpoch.current);
			if (alive.current && value) {
				acknowledge(value);
				if (draftRef.current) {
					const fresh =
						value.presets.find((p) => p.id === draftRef.current?.id) ?? null;
					draftRef.current = fresh;
					setDraft(fresh);
				}
				setConfirm(null);
			}
		} catch (e) {
			if (alive.current) setError(errorMessage(e));
		} finally {
			if (alive.current) setPending(false);
		}
	};
	const ordered =
		localOrder && catalog
			? localOrder.flatMap(
					(id) => catalog.presets.find((p) => p.id === id) ?? [],
				)
			: (catalog?.presets ?? []);
	const changeOrder = (from: number, to: number) => {
		const ids = ordered.map((p) => p.id);
		const moved = ids.splice(from, 1)[0];
		if (moved) {
			ids.splice(to, 0, moved);
			setLocalOrder(ids);
		}
	};
	const linkedAgent = findLinkedAgent(agents, draft?.agentId);
	return (
		<>
			<Button
				size="sm"
				variant="ghost"
				aria-label={t({ message: "Terminal Scripts" })}
				disabled={busy || working}
				onClick={() => setOpen(true)}
			>
				<Trans>Terminal Scripts</Trans>
			</Button>
			{!open && error && (
				<p role="alert" className="text-xs text-destructive">
					{error}
				</p>
			)}
			{open && (
				<Dialog
					open
					onOpenChange={(value) => {
						if (!value && !pending.current && !draftRef.current) setOpen(false);
					}}
				>
					<DialogContent
						data-workstation-terminal-scripts
						className="sm:max-w-4xl max-h-[85vh] overflow-y-auto"
					>
						<DialogHeader>
							<DialogTitle>
								<Trans>Terminal Scripts</Trans>
							</DialogTitle>
							<DialogDescription>
								<Trans>
									Reusable terminal launches. Click a script to edit or drag to
									reorder. Project setup, run, and teardown commands are
									lifecycle scripts.
								</Trans>
							</DialogDescription>
						</DialogHeader>
						{error && !draft && (
							<p role="alert" className="text-destructive">
								{error}
							</p>
						)}
						<div className="flex justify-end gap-2">
							<Button
								size="sm"
								variant="ghost"
								disabled={working}
								onClick={() => void refresh()}
							>
								<Trans>Refresh</Trans>
							</Button>
							<Button
								size="sm"
								disabled={working || blocked.current || !catalog}
								onClick={() => {
									const value: HostTerminalPreset = {
										id: crypto.randomUUID(),
										name: "",
										cwd: "",
										commands: [""],
										projectIds: null,
										executionMode: "new-tab",
										tabOrder: catalog?.presets.length ?? 0,
										createdAt: new Date(),
									};
									draftRef.current = value;
									setDraft(value);
									registry?.changed();
								}}
							>
								<Trans>Add script</Trans>
							</Button>
						</div>
						<fieldset disabled={working || blocked.current}>
							<PresetsTableView
								presets={ordered}
								isDark={theme.type === "dark"}
								isLoading={!catalog}
								agents={agents}
								projectOptionsById={new Map(projects.map((p) => [p.id, p]))}
								presetsContainerRef={container}
								onEdit={(id) => {
									const value = catalog?.presets.find((p) => p.id === id);
									if (value) {
										draftRef.current = structuredClone(value);
										setDraft(draftRef.current);
										setSaved(false);
									}
								}}
								onLocalReorder={changeOrder}
								onPersistReorder={() => {
									if (localOrder)
										void mutate({ kind: "reorder", ids: localOrder });
								}}
								onToggleVisibility={(id, visible) =>
									void mutate({
										kind: "update",
										id,
										patch: { pinnedToBar: visible },
									})
								}
							/>
						</fieldset>
					</DialogContent>
				</Dialog>
			)}
			{draft && (
				<PresetEditorDialogView
					preset={draft}
					projects={projects}
					agents={agents}
					open
					onOpenChange={(value) => {
						if (!value) closeEditor();
					}}
					onDeletePreset={() => {
						if (!pending.current) setConfirm("delete");
					}}
					onFieldChange={(column, value) => changeDraft({ [column]: value })}
					onFieldBlur={() => void saveRef.current()}
					onDirectorySelect={(value) => changeDraft({ cwd: value })}
					onProjectIdsChange={(projectIds) => {
						changeDraft({ projectIds });
						void saveRef.current();
					}}
					onCommandsChange={(commands) => changeDraft({ commands })}
					onCommandsBlur={() => void saveRef.current()}
					onModeChange={(executionMode) => {
						changeDraft({ executionMode });
						void saveRef.current();
					}}
					onToggleAutoApply={(field, value) => {
						changeDraft({ [field]: value });
						void saveRef.current();
					}}
					onToggleWorkspaceRun={(value) => {
						changeDraft({ useAsWorkspaceRun: value });
						void saveRef.current();
					}}
					modeValue={draft.executionMode}
					hasMultipleCommands={draft.commands.length > 1}
					isWorkspaceRun={!!draft.useAsWorkspaceRun}
					isWorkspaceCreation={!!draft.applyOnWorkspaceCreated}
					isNewTab={!!draft.applyOnNewTab}
					linkedAgent={findLinkedAgent(agents, draft.agentId)}
					linkedAgentId={draft.agentId}
					liveCommands={resolvePresetLaunchCommands(draft, agents)}
					linkedCommandText={
						linkedAgent ? getAgentCommandText(linkedAgent) : ""
					}
					onLinkedCommandChange={() => {}}
					onLinkedCommandBlur={() => {}}
					linkedCommandPending
					agentSettingsLink={
						linkedAgent &&
						connection.capabilities?.workstationAgentSettingsV1 === true ? (
							<Button
								type="button"
								variant="link"
								size="sm"
								disabled={working || busy}
								onClick={() => setEditingAgentId(linkedAgent.id)}
							>
								<Trans>Agent settings</Trans>
							</Button>
						) : undefined
					}
					disabled={working}
					preferredProjectId={preferredProjectId}
					onBrowseDirectory={() =>
						void browseDirectory(
							workspacePath
								? draft.cwd.trim()
									? toAbsoluteWorkspacePath(workspacePath, draft.cwd.trim())
									: workspacePath
								: undefined,
						)
					}
					directoryPending={directoryBusy}
					beforeFields={
						<div className="space-y-2">
							{error && (
								<p role="alert" className="text-destructive">
									{error}
								</p>
							)}
							<div className="flex justify-end gap-2">
								<Button
									size="sm"
									variant="ghost"
									disabled={working}
									onClick={() => setConfirm("reload")}
								>
									<Trans>Reload</Trans>
								</Button>
								<Button
									size="sm"
									disabled={working || blocked.current}
									onClick={() => void saveRef.current()}
								>
									<Trans>Save</Trans>
								</Button>
								{saved && (
									<output className="text-sm text-muted-foreground">
										<Trans>Saved</Trans>
									</output>
								)}
							</div>
						</div>
					}
				/>
			)}
			{directoryOpen && (
				<Dialog
					open
					onOpenChange={(v) => {
						if (!v) closeDirectory();
					}}
				>
					<DialogContent
						data-terminal-preset-directory
						className="sm:max-w-xl max-h-[85vh] overflow-y-auto"
					>
						<DialogHeader>
							<DialogTitle>
								<Trans>Select terminal script directory</Trans>
							</DialogTitle>
							<DialogDescription>
								<Trans>
									Use a workspace-relative path or an absolute folder.
								</Trans>
							</DialogDescription>
						</DialogHeader>
						{directoryError && (
							<p role="alert" className="text-destructive">
								{directoryError}
							</p>
						)}
						{directory && (
							<RemoteDirectoryBrowser
								key={directory.path}
								directory={directory}
								busy={directoryBusy}
								onBrowse={(path) => void browseDirectory(path)}
							/>
						)}
						<div className="flex justify-end gap-2">
							<Button variant="ghost" onClick={closeDirectory}>
								<Trans>Cancel</Trans>
							</Button>
							<Button
								disabled={directoryBusy || !directory}
								onClick={() => {
									if (directory) {
										changeDraft({
											cwd: workspacePath
												? toPresetDirectoryValue(workspacePath, directory.path)
												: directory.path,
										});
										closeDirectory();
										void saveRef.current();
									}
								}}
							>
								<Trans>Select folder</Trans>
							</Button>
						</div>
					</DialogContent>
				</Dialog>
			)}

			<UnsavedChangesDialog
				open={confirm !== null}
				onOpenChange={(value) => {
					if (!value) setConfirm(null);
				}}
				isSaving={working}
				closeOnDiscard={false}
				discardLabel={
					confirm === "reload"
						? t({ message: "Reload" })
						: confirm === "delete"
							? t({ message: "Delete script" })
							: t({ message: "Discard & Continue" })
				}
				onDiscard={() => {
					if (confirm === "reload") void refresh();
					else if (confirm === "delete") {
						const id = draftRef.current?.id;
						if (id && catalogRef.current?.presets.some((p) => p.id === id)) {
							void mutate({ kind: "remove", id }).then((ok) => {
								if (ok && alive.current) finishEditor();
							});
						} else finishEditor();
					} else finishEditor();
				}}
				onSave={
					confirm === "close"
						? () => {
								void saveRef.current().then((ok) => {
									if (ok && alive.current) finishEditor();
								});
							}
						: undefined
				}
			/>
			{editingAgentId && (
				<RemoteAgentSettings
					api={api}
					connection={connection}
					agents={agents}
					initialAgentId={editingAgentId}
					onChanged={(row) => onAgentChanged?.(row)}
					onClose={() => setEditingAgentId(null)}
				/>
			)}
		</>
	);
}

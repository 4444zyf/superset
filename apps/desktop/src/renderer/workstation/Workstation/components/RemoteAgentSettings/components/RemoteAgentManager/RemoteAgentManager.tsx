import { Trans, useLingui } from "@lingui/react/macro";
import type { HostAgentConfig } from "@superset/host-service/settings";
import { errorMessage } from "@superset/i18n/errors";
import {
	getDefaultSeedPresets,
	getPresetById,
	HOST_AGENT_PRESETS,
} from "@superset/shared/host-agent-presets";
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
import { AgentDetailHeaderView } from "renderer/routes/_authenticated/settings/agents/components/V2AgentsSettings/components/AgentFormControls/components/AgentDetailHeaderView/AgentDetailHeaderView";
import { AgentIconView } from "renderer/routes/_authenticated/settings/agents/components/V2AgentsSettings/components/AgentIcon/components/AgentIconView/AgentIconView";
import { AgentSettingsEmptyState } from "renderer/routes/_authenticated/settings/agents/components/V2AgentsSettings/components/AgentSettingsEmptyState/AgentSettingsEmptyState";
import { AgentsSettingsSidebarView } from "renderer/routes/_authenticated/settings/agents/components/V2AgentsSettings/components/AgentsSettingsSidebar/components/AgentsSettingsSidebarView/AgentsSettingsSidebarView";
import {
	type CreateCustomAgentInput,
	NewCustomAgentDetailView,
	type NewCustomAgentHandle,
} from "renderer/routes/_authenticated/settings/agents/components/V2AgentsSettings/components/NewCustomAgentDetail/components/NewCustomAgentDetailView/NewCustomAgentDetailView";
import { UnsavedChangesDialog } from "renderer/screens/main/components/WorkspaceView/ContentView/TabsContent/TabView/FileViewerPane/UnsavedChangesDialog";
import type {
	DirectDescriptor,
	DirectWorkstationApi,
} from "../../../../../../../shared/direct-workstation";
import { WorkstationEditorGuardsContext } from "../../../../providers/WorkstationEditorGuards/workstation-editor-guards";
import { useWorkstationAppearance } from "../../../../providers/WorkstationPreferencesContext/WorkstationPreferencesContext";
import {
	AgentConfigEditor,
	type AgentConfigEditorHandle,
	type AgentConfigSnapshot,
} from "../AgentConfigEditor/AgentConfigEditor";
import { WorkstationAgentIconPicker } from "../WorkstationAgentIconPicker/WorkstationAgentIconPicker";

interface Catalog {
	configs: HostAgentConfig[];
	revision: string;
}
type Change =
	| { kind: "add"; id: string; config: CreateCustomAgentInput }
	| { kind: "remove" | "restore"; id: string }
	| { kind: "reset" }
	| { kind: "reorder"; ids: string[] };
const NEW = "new-agent";
const sameConfig = (
	actual: HostAgentConfig | undefined,
	wanted: CreateCustomAgentInput,
) =>
	actual &&
	[
		"label",
		"command",
		"args",
		"env",
		"promptTransport",
		"promptArgs",
		"resumeArgs",
		"forkArgs",
		"presetId",
	].every(
		(key) =>
			JSON.stringify(actual[key as keyof HostAgentConfig]) ===
			JSON.stringify(wanted[key as keyof CreateCustomAgentInput]),
	) &&
	actual.iconId === (wanted.iconId ?? null);
export function RemoteAgentManager({
	api,
	connection,
	agents,
	onChanged,
	onClose,
}: {
	api: DirectWorkstationApi;
	connection: DirectDescriptor;
	agents: HostAgentConfig[];
	onChanged(c: HostAgentConfig): void;
	onClose(): void;
}) {
	const { t } = useLingui(),
		{ theme } = useWorkstationAppearance();
	const catalogPath =
		connection.capabilities?.workstationAgentCatalogV2 === true
			? "catalogWithRevisionV2"
			: "catalogWithRevisionV1";
	const applyPath =
		connection.capabilities?.workstationAgentCatalogV2 === true
			? "applyCatalogChangeV2"
			: "applyCatalogChangeV1";
	const registry = useContext(WorkstationEditorGuardsContext),
		guardId = useId();
	const [catalog, setCatalog] = useState<Catalog | null>(null),
		[selected, setSelected] = useState<string | null>(agents[0]?.id ?? null),
		[epoch, setEpoch] = useState(0);
	const [snapshot, setSnapshot] = useState<{
			key: string;
			value: AgentConfigSnapshot;
		} | null>(null),
		[error, setErrorState] = useState<string | null>(null),
		[conflicted, setConflicted] = useState(false),
		[busy, setBusy] = useState(false);
	const [confirm, setConfirm] = useState<Change | null>(null),
		[intent, setIntent] = useState<(() => void) | null>(null),
		[guardError, setGuardError] = useState<string | null>(null);
	const mounted = useRef(false),
		pending = useRef(false),
		editor = useRef<AgentConfigEditorHandle>(null),
		creation = useRef<NewCustomAgentHandle>(null),
		creationSaved = useRef(false),
		errorRef = useRef<string | null>(null),
		createId = useRef(crypto.randomUUID());
	const queryKey = JSON.stringify([selected, epoch]);
	const current = useRef(queryKey);
	current.current = queryKey;
	const setError = useCallback(
		(message: string | null) => {
			errorRef.current = message;
			setErrorState(message);
			registry?.changed();
		},
		[registry],
	);
	const rpc = useCallback(
		<T,>(path: string, type: "query" | "mutation", input?: unknown) =>
			api.rpc<T>({
				connectionId: connection.connectionId,
				generation: connection.generation,
				path: `settings.agentConfigs.${path}`,
				type,
				input,
			}),
		[api, connection.connectionId, connection.generation],
	);
	const setPending = (value: boolean) => {
		pending.current = value;
		setBusy(value);
		registry?.changed();
	};
	useEffect(() => {
		mounted.current = true;
		let active = true;
		void rpc<Catalog>(catalogPath, "query")
			.then((value) => {
				if (active) {
					setCatalog(value);
					setSelected((id) =>
						value.configs.some((c) => c.id === id)
							? id
							: (value.configs[0]?.id ?? null),
					);
				}
			})
			.catch((e) => {
				if (active) setError(errorMessage(e));
			});
		return () => {
			active = false;
			mounted.current = false;
		};
	}, [rpc, setError, catalogPath]);
	useEffect(() => {
		if (!selected || selected === NEW) return;
		let active = true;
		void rpc<AgentConfigSnapshot>("getWithRevisionV1", "query", {
			id: selected,
		})
			.then((value) => {
				if (active && current.current === queryKey)
					setSnapshot({ key: queryKey, value });
			})
			.catch((e) => {
				if (active && current.current === queryKey) setError(errorMessage(e));
			});
		return () => {
			active = false;
		};
	}, [queryKey, selected, rpc, setError]);
	const isDirty = () =>
		selected === NEW
			? !creationSaved.current && Boolean(creation.current?.isDirty())
			: Boolean(editor.current?.isDirty());
	const save = async () =>
		selected === NEW
			? Boolean(await creation.current?.save())
			: Boolean(await editor.current?.save());
	const saveRef = useRef(save);
	saveRef.current = save;
	useEffect(
		() =>
			selected === NEW
				? registry?.register({
						id: guardId,
						label: () => t({ message: "New agent" }),
						isDirty: () =>
							!creationSaved.current && Boolean(creation.current?.isDirty()),
						isPending: () => pending.current,
						getError: () => errorRef.current,
						save: () => saveRef.current(),
					})
				: undefined,
		[selected, registry, guardId, t],
	);
	const request = (action: () => void) => {
		if (pending.current) return;
		if (isDirty()) {
			setGuardError(null);
			setIntent(() => action);
		} else action();
	};
	const refresh = async () => {
		if (pending.current) return;
		setPending(true);
		try {
			const value = await rpc<Catalog>(catalogPath, "query");
			if (!mounted.current) return;
			setCatalog(value);
			setConflicted(false);
			setError(null);
			setEpoch((v) => v + 1);
		} catch (e) {
			if (mounted.current) setError(errorMessage(e));
		} finally {
			if (mounted.current) setPending(false);
		}
	};
	const applied = (value: Catalog, change: Change) => {
		switch (change.kind) {
			case "add":
				return sameConfig(
					value.configs.find((c) => c.id === change.id),
					change.config,
				);
			case "remove":
				return !value.configs.some((c) => c.id === change.id);
			case "reorder":
				return (
					JSON.stringify(value.configs.map((c) => c.id)) ===
					JSON.stringify(change.ids)
				);
			case "restore": {
				const row = value.configs.find((c) => c.id === change.id),
					preset = row && getPresetById(row.presetId);
				return Boolean(
					preset && sameConfig(row, { ...preset, iconId: undefined }),
				);
			}
			case "reset": {
				const presets = getDefaultSeedPresets();
				return (
					value.configs.length === presets.length &&
					value.configs.every((row, i) =>
						Boolean(presets[i] && sameConfig(row, presets[i])),
					)
				);
			}
		}
	};
	const acknowledge = (value: Catalog, change: Change) => {
		setCatalog(value);
		setConfirm(null);
		setConflicted(false);
		setError(null);
		if (change.kind === "add") {
			creationSaved.current = true;
			setSelected(change.id);
		} else if (change.kind === "reset")
			setSelected(value.configs[0]?.id ?? null);
		else if (change.kind === "remove" && selected === change.id)
			setSelected(value.configs[0]?.id ?? null);
		setEpoch((v) => v + 1);
		registry?.changed();
	};
	const apply = async (change: Change) => {
		if (pending.current || !catalog || conflicted) return false;
		setPending(true);
		setError(null);
		try {
			const result = await rpc<Catalog>(applyPath, "mutation", {
				expectedRevision: catalog.revision,
				change,
			});
			if (!mounted.current) return false;
			acknowledge(result, change);
			return true;
		} catch (e) {
			if (!mounted.current) return false;
			try {
				const value = await rpc<Catalog>(catalogPath, "query");
				if (!mounted.current) return false;
				if (applied(value, change)) {
					acknowledge(value, change);
					return true;
				}
				if (value.revision !== catalog.revision) {
					setConflicted(true);
					setError(
						t({ message: "This configuration changed. Reload before saving." }),
					);
					return false;
				}
			} catch {}
			if (mounted.current)
				setError(errorMessage(e, t({ message: "Failed to save" })));
			return false;
		} finally {
			if (mounted.current) setPending(false);
		}
	};
	const renderIcon = (props: {
		iconId?: string | null;
		presetId: string;
		className: string;
	}) => <AgentIconView {...props} isDark={theme.type === "dark"} />;
	const row = catalog?.configs.find((c) => c.id === selected);
	return (
		<>
			<Dialog
				open
				modal
				onOpenChange={(open) => {
					if (!open) request(onClose);
				}}
			>
				<DialogContent
					data-workstation-agent-settings
					className="grid max-h-[85vh] min-w-0 grid-cols-[minmax(0,1fr)] overflow-y-auto sm:max-w-5xl"
				>
					<DialogHeader>
						<DialogTitle>
							<Trans>Agents</Trans>
						</DialogTitle>
						<DialogDescription>
							<Trans>Terminal agent launch configuration</Trans>
						</DialogDescription>
					</DialogHeader>
					<div className="flex items-center gap-2">
						<Button
							variant="outline"
							disabled={busy}
							onClick={() => request(() => void refresh())}
						>
							<Trans>Refresh</Trans>
						</Button>
						{error && (
							<p role="alert" className="text-sm text-destructive">
								{error}
							</p>
						)}
					</div>
					<div className="grid min-w-0 md:grid-cols-[16rem_minmax(0,1fr)]">
						<fieldset
							disabled={busy || !catalog}
							className="min-w-0 [&>div]:w-full [&>div]:max-h-52 md:[&>div]:max-h-none"
						>
							<AgentsSettingsSidebarView
								menuModal
								configs={catalog?.configs ?? agents}
								presets={[...HOST_AGENT_PRESETS]}
								selectedAgentId={selected}
								onSelectAgent={(id) => {
									if (id !== selected) request(() => setSelected(id));
								}}
								onAddAgent={(preset) =>
									request(() => {
										const { description: _description, ...config } = preset;
										void apply({
											kind: "add",
											id: crypto.randomUUID(),
											config,
										});
									})
								}
								onCreateCustomAgent={() =>
									request(() => {
										createId.current = crypto.randomUUID();
										creationSaved.current = false;
										setError(null);
										setSelected(NEW);
									})
								}
								onReorder={(ids) =>
									request(() => void apply({ kind: "reorder", ids }))
								}
								onResetToDefaults={() =>
									request(() => setConfirm({ kind: "reset" }))
								}
								isAdding={busy || !catalog}
								isResetting={busy || !catalog}
								renderIcon={renderIcon}
							/>
						</fieldset>
						<div className="min-w-0">
							{selected === NEW ? (
								<fieldset disabled={busy}>
									<NewCustomAgentDetailView
										key={queryKey}
										ref={creation}
										isSubmitting={busy}
										onCreate={(config) =>
											apply({ kind: "add", id: createId.current, config })
										}
										onCancel={() =>
											request(() =>
												setSelected(catalog?.configs[0]?.id ?? null),
											)
										}
										onDirtyChange={() => {
											creationSaved.current = false;
											registry?.changed();
										}}
										renderHeader={(iconId, title) => (
											<AgentDetailHeaderView
												icon={renderIcon({
													iconId,
													presetId: "custom",
													className: "size-8",
												})}
												title={title}
												subtitle={t({
													message:
														"Add your own terminal agent to this device.",
												})}
											/>
										)}
										renderIconPicker={(value, onChange, disabled) => (
											<WorkstationAgentIconPicker
												value={value}
												onChange={onChange}
												disabled={disabled}
											/>
										)}
									/>
								</fieldset>
							) : snapshot?.key === queryKey ? (
								<>
									<AgentConfigEditor
										key={queryKey}
										ref={editor}
										api={api}
										connection={connection}
										snapshot={snapshot.value}
										onPendingChange={setPending}
										onReloaded={() => {
											void rpc<Catalog>(catalogPath, "query")
												.then((value) => {
													if (mounted.current) setCatalog(value);
												})
												.catch((e) => {
													if (mounted.current) setError(errorMessage(e));
												});
										}}
										onChanged={(config) => {
											onChanged(config);
											void rpc<Catalog>(catalogPath, "query")
												.then((value) => {
													if (mounted.current) setCatalog(value);
												})
												.catch((e) => {
													if (mounted.current) setError(errorMessage(e));
												});
										}}
									/>
									<div className="flex flex-wrap gap-2 p-4">
										<Button
											variant="destructive"
											disabled={busy || !catalog}
											onClick={() =>
												request(() =>
													setConfirm({
														kind: "remove",
														id: snapshot.value.config.id,
													}),
												)
											}
										>
											<Trans>Delete agent</Trans>
										</Button>
										{row && getPresetById(row.presetId) && (
											<Button
												variant="outline"
												disabled={busy || !catalog}
												onClick={() =>
													request(() =>
														setConfirm({ kind: "restore", id: row.id }),
													)
												}
											>
												<Trans>Restore defaults</Trans>
											</Button>
										)}
									</div>
								</>
							) : catalog && !selected ? (
								<AgentSettingsEmptyState />
							) : (
								<p className="p-4">
									<Trans>Loading...</Trans>
								</p>
							)}
						</div>
					</div>
				</DialogContent>
			</Dialog>
			<UnsavedChangesDialog
				open={Boolean(intent)}
				onOpenChange={(open) => {
					if (!open && !pending.current) setIntent(null);
				}}
				isSaving={busy}
				title={t({ message: "Unsaved changes" })}
				description={t({
					message: "Your changes will be lost if you don't save them.",
				})}
				discardLabel={t({ message: "Discard changes" })}
				saveLabel={t({ message: "Save" })}
				details={
					guardError ? (
						<p role="alert" className="text-destructive">
							{guardError}
						</p>
					) : null
				}
				onDiscard={() => {
					creationSaved.current = true;
					registry?.changed();
					setEpoch((v) => v + 1);
					const action = intent;
					setIntent(null);
					action?.();
				}}
				onSave={() => {
					const action = intent;
					void save().then((ok) => {
						if (!mounted.current) return;
						if (ok) {
							setIntent(null);
							action?.();
						} else
							setGuardError(
								errorRef.current ??
									editor.current?.getError() ??
									t({ message: "Failed to save" }),
							);
					});
				}}
			/>
			<UnsavedChangesDialog
				open={Boolean(confirm)}
				onOpenChange={(open) => {
					if (!open && !pending.current) setConfirm(null);
				}}
				closeOnDiscard={false}
				isSaving={busy}
				title={
					confirm?.kind === "remove"
						? t({ message: "Delete agent" })
						: confirm?.kind === "reset"
							? t({ message: "Reset to defaults" })
							: t({ message: "Restore defaults" })
				}
				description={
					confirm?.kind === "remove"
						? t({ message: "Removes this agent from this device only." })
						: t({ message: "This action cannot be undone." })
				}
				discardLabel={
					confirm?.kind === "remove"
						? t({ message: "Delete" })
						: t({ message: "Confirm" })
				}
				details={
					<>
						<p>{row?.label}</p>
						{error && (
							<p role="alert" className="text-destructive">
								{error}
							</p>
						)}
					</>
				}
				onDiscard={() => {
					if (confirm) void apply(confirm);
				}}
			/>
		</>
	);
}

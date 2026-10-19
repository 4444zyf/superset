import { Trans, useLingui } from "@lingui/react/macro";
import type {
	HostAgentConfig,
	HostTerminalPreset,
	HostTerminalPresetCatalog,
} from "@superset/host-service/settings";
import { errorMessage } from "@superset/i18n/errors";
import { Button } from "@superset/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@superset/ui/dropdown-menu";
import { getPresetIcon } from "@superset/ui/icons/preset-icons";
import { Settings } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
	getAgentCommandText,
	resolvePresetLaunchCommands,
} from "renderer/lib/agent-launch-command";
import { resolveV2PresetIconKey } from "renderer/lib/preset-icon-key";
import { PresetBarButton } from "renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/components/V2PresetsBar/components/PresetBarButton/PresetBarButton";
import { createDefaultV2TerminalPresetRows } from "renderer/routes/_authenticated/components/AgentHooks/hooks/useDefaultV2TerminalPresets/default-v2-terminal-presets";
import { filterMatchingPresetsForProject } from "shared/preset-project-targeting";
import type {
	DirectDescriptor,
	DirectWorkstationApi,
} from "../../../../../shared/direct-workstation";
import { useWorkstationAppearance } from "../../providers/WorkstationPreferencesContext/WorkstationPreferencesContext";
import { RemoteAgentSettings } from "../RemoteAgentSettings/RemoteAgentSettings";
import { RemoteTerminalScripts } from "../RemoteTerminalScripts/RemoteTerminalScripts";

export function RemoteTerminalPresets({
	api,
	connection,
	workspaceId,
	busy,
	onLaunch,
	onLaunchScript,
	configurationRequest,
}: {
	api: DirectWorkstationApi;
	connection: DirectDescriptor;
	workspaceId: string;
	busy: boolean;
	onLaunch(launch: { initialCommand: string; label: string }): void;
	onLaunchScript?(preset: HostTerminalPreset, agents: HostAgentConfig[]): void;
	configurationRequest?: { requestId: string; presetId?: string };
}) {
	const { t } = useLingui();
	const { theme } = useWorkstationAppearance();
	const owner = JSON.stringify([
		connection.connectionId,
		connection.backendId,
		connection.namespaceId,
		connection.generation,
		workspaceId,
	]);
	const capable =
		connection.capabilities?.workstationTerminalPresetsV1 === true &&
		connection.capabilities.durableOperations === true &&
		connection.capabilities.terminals === true;
	const versionedCatalog =
		connection.capabilities?.workstationAgentCatalogV2 === true;
	const [state, setState] = useState<{
		owner: string;
		agents: HostAgentConfig[];
		error?: string;
		loaded?: boolean;
	}>({ owner, agents: [] });
	const [reload, setReload] = useState(0);
	const [editingOwner, setEditingOwner] = useState<string | null>(null);
	const requestKey = JSON.stringify([owner, reload]);
	const current = useRef(requestKey);
	current.current = requestKey;
	const agents = state.owner === owner && capable ? state.agents : [];
	useEffect(() => {
		if (!capable) return;
		let active = true;
		void api
			.rpc<HostAgentConfig[] | { configs: HostAgentConfig[] }>({
				connectionId: connection.connectionId,
				generation: connection.generation,
				path: versionedCatalog
					? "settings.agentConfigs.catalogWithRevisionV2"
					: "settings.agentConfigs.list",
				type: "query",
				input: undefined,
			})
			.then((result) => {
				const agents = Array.isArray(result) ? result : result.configs;
				if (active && current.current === requestKey)
					setState({ owner, agents, loaded: true });
			})
			.catch((error) => {
				if (active && current.current === requestKey)
					setState({ owner, agents: [], error: errorMessage(error) });
			});
		return () => {
			active = false;
		};
	}, [
		api,
		capable,
		owner,
		connection.connectionId,
		connection.generation,
		requestKey,
		versionedCatalog,
	]);
	const executionCapable =
		connection.capabilities?.workstationTerminalScriptExecutionV1 === true;
	const scriptsCapable =
		connection.capabilities?.workstationTerminalScriptsV1 === true;
	const [scriptState, setScriptState] = useState<{
		owner: string;
		catalog: HostTerminalPresetCatalog;
	} | null>(null);
	const [projectState, setProjectState] = useState<{
		owner: string;
		projectId: string;
	} | null>(null);
	const [scriptError, setScriptError] = useState<{
		owner: string;
		message: string;
	} | null>(null);
	const catalogEpoch = useRef(0);
	const publishCatalog = useCallback(
		(catalog: HostTerminalPresetCatalog) => {
			catalogEpoch.current++;
			setScriptState({ owner, catalog });
		},
		[owner],
	);
	useEffect(() => {
		if (!capable || !scriptsCapable || state.owner !== owner || !state.loaded)
			return;
		let active = true;
		const epoch = catalogEpoch.current;
		const query = <T,>(path: string, input?: unknown) =>
			api.rpc<T>({
				connectionId: connection.connectionId,
				generation: connection.generation,
				path,
				type: "query",
				input,
			});
		void Promise.all([
			query<HostTerminalPresetCatalog>(
				"settings.terminalPresets.catalogWithRevisionV1",
			),
			query<{ projectId: string }>("workspace.get", { id: workspaceId }),
		])
			.then(([catalog, workspace]) => {
				if (!active || current.current !== requestKey) return;
				setProjectState({ owner, projectId: workspace.projectId });
				if (catalogEpoch.current === epoch) setScriptState({ owner, catalog });
				setScriptError(null);
			})
			.catch((error) => {
				if (active && current.current === requestKey)
					setScriptError({ owner, message: errorMessage(error) });
			});
		return () => {
			active = false;
		};
	}, [
		api,
		capable,
		scriptsCapable,
		state.owner,
		state.loaded,
		owner,
		requestKey,
		connection.connectionId,
		connection.generation,
		workspaceId,
	]);
	const scripts =
		scriptState?.owner === owner &&
		projectState?.owner === owner &&
		scriptState.catalog.initialized
			? filterMatchingPresetsForProject(
					scriptState.catalog.presets,
					projectState.projectId,
				).filter((preset) => preset.pinnedToBar !== false)
			: [];
	let index = 0;
	const presets = createDefaultV2TerminalPresetRows({
		agents,
		existingPresets: [],
		createId: () => String(index++),
		createdAt: new Date(0),
	});
	const launch = (agent: HostAgentConfig) => {
		if (busy || !capable || !agent.command.trim()) return;
		onLaunch({
			initialCommand: getAgentCommandText(agent),
			label: agent.label,
		});
	};
	return (
		<>
			<section
				data-workstation-presets
				aria-label={t({ message: "Terminal Scripts" })}
				className="flex min-w-0 shrink-0 flex-wrap items-center gap-1.5 bg-background px-2 py-1"
			>
				{!capable ? (
					<Button
						size="sm"
						variant="ghost"
						disabled
						title={t({
							message: "This backend does not support the required capability",
						})}
					>
						<Trans>Terminal Scripts</Trans>
					</Button>
				) : (
					<>
						{state.owner === owner && state.loaded && (
							<RemoteTerminalScripts
								api={api}
								connection={connection}
								agents={agents}
								workspaceId={workspaceId}
								busy={busy}
								onCatalogChanged={publishCatalog}
								configurationRequest={configurationRequest}
							/>
						)}
						<Button
							variant="ghost"
							size="icon-sm"
							aria-label={t({ message: "Agent settings" })}
							title={
								connection.capabilities?.workstationAgentSettingsV1 === true
									? t({ message: "Agent settings" })
									: t({
											message:
												"This backend does not support the required capability",
										})
							}
							disabled={
								busy ||
								(!agents.length &&
									connection.capabilities?.workstationAgentManagementV1 !==
										true) ||
								connection.capabilities?.workstationAgentSettingsV1 !== true
							}
							onClick={() => setEditingOwner(owner)}
						>
							<Settings size={14} />
						</Button>
						<DropdownMenu>
							<DropdownMenuTrigger asChild>
								<Button
									variant="ghost"
									size="sm"
									disabled={busy || agents.length === 0}
								>
									<Trans>Agents</Trans>
								</Button>
							</DropdownMenuTrigger>
							<DropdownMenuContent className="max-h-80 overflow-y-auto">
								{agents.map((agent) => (
									<DropdownMenuItem
										key={agent.id}
										disabled={busy || !agent.command.trim()}
										onSelect={() => launch(agent)}
									>
										{agent.label}
									</DropdownMenuItem>
								))}
							</DropdownMenuContent>
						</DropdownMenu>
						{scriptsCapable
							? scripts.map((preset) => {
									const key = resolveV2PresetIconKey(preset, agents);
									return (
										<div key={preset.id} data-workstation-script-id={preset.id}>
											<PresetBarButton
												name={preset.name}
												icon={
													key
														? getPresetIcon(key, theme.type === "dark")
														: undefined
												}
												title={resolvePresetLaunchCommands(preset, agents).join(
													" && ",
												)}
												disabled={busy || !executionCapable || !onLaunchScript}
												onClick={() => {
													if (!busy && executionCapable)
														onLaunchScript?.(preset, agents);
												}}
											/>
										</div>
									);
								})
							: presets.map((preset) => {
									const agent = agents.find((a) => a.id === preset.agentId);
									return agent ? (
										<PresetBarButton
											key={agent.id}
											name={preset.name}
											icon={getPresetIcon(
												agent.iconId ?? agent.presetId,
												theme.type === "dark",
											)}
											title={getAgentCommandText(agent)}
											disabled={busy}
											onClick={() => launch(agent)}
										/>
									) : null;
								})}
						<Button
							size="sm"
							variant="ghost"
							disabled={busy}
							onClick={() => setReload((value) => value + 1)}
						>
							<Trans>Refresh</Trans>
						</Button>
						{scriptError?.owner === owner && (
							<p role="alert" className="text-xs text-destructive">
								{scriptError.message}
							</p>
						)}
						{state.owner === owner && state.error && (
							<p role="alert" className="text-xs text-destructive">
								{state.error}
							</p>
						)}
					</>
				)}
			</section>
			{editingOwner === owner && (
				<RemoteAgentSettings
					api={api}
					connection={connection}
					agents={agents}
					onClose={() => {
						setEditingOwner(null);
						setReload((v) => v + 1);
					}}
					onChanged={(row) =>
						setState((previous) =>
							previous.owner === owner
								? {
										...previous,
										agents: previous.agents.map((agent) =>
											agent.id === row.id ? row : agent,
										),
									}
								: previous,
						)
					}
				/>
			)}
		</>
	);
}

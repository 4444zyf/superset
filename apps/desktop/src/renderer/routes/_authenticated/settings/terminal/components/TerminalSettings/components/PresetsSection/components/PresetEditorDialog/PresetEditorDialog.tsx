import { Trans, useLingui } from "@lingui/react/macro";
import type { HostAgentConfig } from "@superset/host-service/settings";
import { errorMessage } from "@superset/i18n/errors";
import type { TerminalPreset } from "@superset/local-db";
import { Alert, AlertDescription } from "@superset/ui/alert";
import { toast } from "@superset/ui/sonner";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ExternalLink } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { HiExclamationTriangle } from "react-icons/hi2";
import { V2_AGENT_CONFIGS_QUERY_KEY } from "renderer/hooks/useV2AgentConfigs";
import {
	findLinkedAgent,
	getAgentCommandText,
	isAgentCommandPatchChanged,
	parseAgentCommandText,
	resolvePresetLaunchCommands,
} from "renderer/lib/agent-launch-command";
import { electronTrpc } from "renderer/lib/electron-trpc";
import { getHostServiceClientByUrl } from "renderer/lib/host-service-client";
import { getHostServiceUnavailableMessage } from "renderer/lib/host-service-unavailable";
import { useLocalHostService } from "renderer/routes/_authenticated/providers/LocalHostServiceProvider";
import { useSettingsOriginRoute } from "renderer/stores/settings-state";
import {
	isAbsoluteFilesystemPath,
	toAbsoluteWorkspacePath,
} from "shared/absolute-paths";
import {
	type PresetEditorDialogProps,
	PresetEditorDialogView,
} from "./components/PresetEditorDialogView/PresetEditorDialogView";
import { toPresetDirectoryValue } from "./preset-directory-value";

interface PresetWithAgent extends TerminalPreset {
	agentId?: string;
}

function getWorkspaceIdFromRoute(route: string): string | null {
	const match = route.match(/\/workspace\/([^/]+)/);
	return match ? match[1] : null;
}

export function PresetEditorDialog(props: PresetEditorDialogProps) {
	const {
		preset,
		agents,
		onLinkedAgentSaved,
		open,
		onOpenChange,
		onDirectorySelect,
	} = props;
	const { t } = useLingui();
	const linkedAgent = useMemo(() => {
		const presetAgentId = (preset as PresetWithAgent | null)?.agentId;
		return findLinkedAgent(agents, presetAgentId);
	}, [preset, agents]);
	const linkedAgentId = (preset as PresetWithAgent | null)?.agentId;
	const liveCommands = useMemo(
		() =>
			preset
				? resolvePresetLaunchCommands(preset as PresetWithAgent, agents)
				: [],
		[preset, agents],
	);
	const hostService = useLocalHostService();
	const { activeHostUrl } = hostService;
	const queryClient = useQueryClient();
	const queryFamily = { queryKey: V2_AGENT_CONFIGS_QUERY_KEY };
	const [linkedCommandText, setLinkedCommandText] = useState(() =>
		linkedAgent ? getAgentCommandText(linkedAgent) : "",
	);
	const selectDirectory = electronTrpc.window.selectDirectory.useMutation();
	const originRoute = useSettingsOriginRoute();

	useEffect(() => {
		if (linkedAgent) setLinkedCommandText(getAgentCommandText(linkedAgent));
	}, [linkedAgent]);

	const updateLinkedAgentMutation = useMutation({
		mutationFn: ({
			id,
			patch,
		}: {
			id: string;
			patch: ReturnType<typeof parseAgentCommandText>;
		}) => {
			if (!activeHostUrl) {
				throw new Error(
					getHostServiceUnavailableMessage(hostService, {
						action: "saveAgentCommand",
					}),
				);
			}
			return getHostServiceClientByUrl(
				activeHostUrl,
			).settings.agentConfigs.update.mutate({ id, patch });
		},
		onSuccess: (updated) => {
			queryClient.setQueriesData<HostAgentConfig[]>(queryFamily, (current) =>
				current?.map((config) =>
					config.id === updated.id ? { ...config, ...updated } : config,
				),
			);
			void queryClient.invalidateQueries(queryFamily);
			onLinkedAgentSaved?.(updated);
		},
		onError: (err) =>
			toast.error(
				errorMessage(
					err,
					t({
						message: "Failed to save",
					}),
				),
			),
	});

	const handleLinkedCommandBlur = () => {
		if (!linkedAgent) return;
		const patch = parseAgentCommandText(linkedCommandText);
		if (patch.command.length === 0) {
			toast.error(
				t({
					message: "Command cannot be empty",
				}),
			);
			setLinkedCommandText(getAgentCommandText(linkedAgent));
			return;
		}
		if (!isAgentCommandPatchChanged(linkedAgent, patch)) return;
		updateLinkedAgentMutation.mutate({ id: linkedAgent.id, patch });
	};

	const trimmedCwd = preset?.cwd.trim() ?? "";
	const originWorkspaceId = useMemo(
		() => getWorkspaceIdFromRoute(originRoute),
		[originRoute],
	);
	const { data: originWorkspace } = electronTrpc.workspaces.get.useQuery(
		{ id: originWorkspaceId ?? "" },
		{ enabled: open && !!originWorkspaceId },
	);
	const isAbsolutePath = isAbsoluteFilesystemPath(trimmedCwd);
	const browseDefaultPath =
		(originWorkspace?.worktreePath && trimmedCwd
			? toAbsoluteWorkspacePath(originWorkspace.worktreePath, trimmedCwd)
			: undefined) ??
		(isAbsolutePath ? trimmedCwd : undefined) ??
		originWorkspace?.worktreePath ??
		undefined;
	const { data: directoryStatus } =
		electronTrpc.window.getDirectoryStatus.useQuery(
			{ path: trimmedCwd },
			{
				enabled: open && Boolean(trimmedCwd) && isAbsolutePath,
				staleTime: 5_000,
			},
		);

	const handleBrowseDirectory = async () => {
		const result = await selectDirectory.mutateAsync({
			title: t({
				message: "Select terminal script directory",
			}),
			defaultPath: browseDefaultPath,
		});
		if (!result.canceled && result.path) {
			if (originWorkspace?.worktreePath) {
				onDirectorySelect(
					toPresetDirectoryValue(originWorkspace.worktreePath, result.path),
				);
				return;
			}
			onDirectorySelect(result.path);
		}
	};

	const directoryAlert =
		trimmedCwd && isAbsolutePath && directoryStatus?.exists === false ? (
			<Alert variant="destructive">
				<HiExclamationTriangle />
				<AlertDescription>
					<Trans>
						This directory does not exist. The terminal script will fall back to
						the workspace root.
					</Trans>
				</AlertDescription>
			</Alert>
		) : trimmedCwd &&
			isAbsolutePath &&
			directoryStatus?.exists &&
			!directoryStatus.isDirectory ? (
			<Alert variant="destructive">
				<HiExclamationTriangle />
				<AlertDescription>
					<Trans>This path exists, but it is not a directory.</Trans>
				</AlertDescription>
			</Alert>
		) : null;

	return (
		<PresetEditorDialogView
			{...props}
			linkedAgent={linkedAgent}
			linkedAgentId={linkedAgentId}
			liveCommands={liveCommands}
			linkedCommandText={linkedCommandText}
			onLinkedCommandChange={setLinkedCommandText}
			onLinkedCommandBlur={handleLinkedCommandBlur}
			linkedCommandPending={updateLinkedAgentMutation.isPending}
			agentSettingsLink={
				linkedAgentId ? (
					<Link
						to="/settings/agents/$agentId"
						params={{ agentId: linkedAgentId }}
						onClick={() => onOpenChange(false)}
						className="inline-flex shrink-0 items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
					>
						<Trans>
							Open{" "}
							{linkedAgent?.label ??
								t({
									message: "agent settings",
								})}
						</Trans>
						<ExternalLink className="size-3" />
					</Link>
				) : undefined
			}
			preferredProjectId={originWorkspace?.projectId ?? null}
			directoryAlert={directoryAlert}
			onBrowseDirectory={handleBrowseDirectory}
			directoryPending={selectDirectory.isPending}
		/>
	);
}

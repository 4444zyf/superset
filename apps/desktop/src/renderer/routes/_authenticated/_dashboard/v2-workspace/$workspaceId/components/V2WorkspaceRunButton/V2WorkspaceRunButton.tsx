import { WorkspaceRunControl } from "renderer/components/WorkspaceRunControl";
import { useHotkeyDisplay } from "renderer/hotkeys";
import type { WorkspaceRunDefinition } from "shared/workspace-run-definition";
import { useConfigureWorkspaceRun } from "../../hooks/useConfigureWorkspaceRun";

interface V2WorkspaceRunButtonProps {
	projectId: string | null;
	definition: WorkspaceRunDefinition | null;
	isRunning: boolean;
	isPending: boolean;
	canForceStop: boolean;
	onToggle(): void | Promise<void>;
	onForceStop(): void | Promise<void>;
}
export function V2WorkspaceRunButton({
	projectId,
	...props
}: V2WorkspaceRunButtonProps) {
	const hotkeyText = useHotkeyDisplay("RUN_WORKSPACE_COMMAND").text;
	const onConfigure = useConfigureWorkspaceRun(projectId, props.definition);
	return (
		<WorkspaceRunControl
			{...props}
			hotkeyText={hotkeyText}
			onConfigure={onConfigure}
		/>
	);
}

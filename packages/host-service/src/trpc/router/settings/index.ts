import { router } from "../../index";
import { agentConfigsRouter } from "./agent-configs";
import { branchPrefixRouter } from "./branch-prefix";
import { terminalPresetsRouter } from "./terminal-presets";
import { worktreeLocationRouter } from "./worktree-location";

export const settingsRouter = router({
	agentConfigs: agentConfigsRouter,
	branchPrefix: branchPrefixRouter,
	worktreeLocation: worktreeLocationRouter,
	terminalPresets: terminalPresetsRouter,
});

export type { HostAgentConfig } from "./agent-configs";
export type {
	HostTerminalPreset,
	HostTerminalPresetCatalog,
} from "./terminal-presets";
export type { HostWorktreeLocationSettings } from "./worktree-location";

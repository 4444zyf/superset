import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";

let directWorkspaceHome: string | null = null;
let directMachineHome: string | null = null;

export function configureManagedWorkspaceHome(
	homeDir: string | null,
	machineHome = homedir(),
): void {
	if (homeDir && !isAbsolute(homeDir))
		throw new Error("Expected an absolute managed workspace home");
	if (!isAbsolute(machineHome))
		throw new Error("Expected an absolute machine home");
	directWorkspaceHome = homeDir;
	directMachineHome = homeDir ? machineHome : null;
}

export function managedWorkspaceRoot(kind: "sessions" | "worktrees"): string {
	if (kind === "worktrees" && directMachineHome)
		return join(directMachineHome, "Superset Remix", "worktrees");
	return join(directWorkspaceHome ?? join(homedir(), ".superset"), kind);
}

export function managedRunCompletionRoot(): string | null {
	return directWorkspaceHome
		? join(directWorkspaceHome, "run-completions")
		: null;
}

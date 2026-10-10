import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";

let directWorkspaceHome: string | null = null;

export function configureManagedWorkspaceHome(homeDir: string | null): void {
	if (homeDir && !isAbsolute(homeDir))
		throw new Error("Expected an absolute managed workspace home");
	directWorkspaceHome = homeDir;
}

export function managedWorkspaceRoot(kind: "sessions" | "worktrees"): string {
	return join(directWorkspaceHome ?? join(homedir(), ".superset"), kind);
}

import { afterEach, expect, test } from "bun:test";
import {
	defaultSessionsRoot,
	safeResolveSessionPath,
} from "../trpc/router/workspace-creation/shared/session-paths";
import { defaultWorktreesRoot } from "../trpc/router/workspace-creation/shared/worktree-paths";
import { configureManagedWorkspaceHome } from "./managed-paths";

afterEach(() => configureManagedWorkspaceHome(null));

test("direct sessions and worktrees stay in the isolated backend home", () => {
	configureManagedWorkspaceHome("/tmp/isolated-direct-home");
	expect(defaultSessionsRoot()).toBe("/tmp/isolated-direct-home/sessions");
	expect(defaultWorktreesRoot()).toBe("/tmp/isolated-direct-home/worktrees");
	expect(safeResolveSessionPath("example")).toBe(
		"/tmp/isolated-direct-home/sessions/example",
	);
	expect(() => safeResolveSessionPath("../../legacy-home")).toThrow(
		"path traversal",
	);
});

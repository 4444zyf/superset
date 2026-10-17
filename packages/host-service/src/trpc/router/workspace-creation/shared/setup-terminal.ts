import { eq } from "drizzle-orm";
import { projects, workspaces } from "../../../../db/schema";
import {
	resolveScript,
	shellSingleQuote,
} from "../../../../runtime/setup/config";
import { managedSetupCompletionRoot } from "../../../../direct/managed-paths";
import {
	RunCompletionStore as CommandCompletionStore,
	supportsRunCompletion,
} from "../../../../direct/run-completion";
import type { WorkspaceSetup } from "../../../../direct/workspace-setups";
import {
	getTerminalBaseEnv,
	resolveLaunchShell,
	waitForTerminalBaseEnv,
} from "../../../../terminal/env";
import { createTerminalSessionInternal } from "../../../../terminal/terminal";
import type { HostServiceContext } from "../../../../types";
import type { TerminalDescriptor } from "./types";

interface StartSetupTerminalArgs {
	ctx: HostServiceContext;
	workspaceId: string;
	/**
	 * Appended to the resolved setup command with ` && `, so it runs in the
	 * setup terminal only after setup succeeds. Ignored when no setup command
	 * resolves — the caller must then dispatch it separately.
	 */
	chainCommand?: string;
}

interface StartSetupTerminalResult {
	terminal: TerminalDescriptor | null;
	warning: string | null;
	/** True when `chainCommand` was chained into the started setup terminal. */
	chained: boolean;
}

/**
 * Resolve and start the workspace-creation setup terminal, if any.
 *
 * Source order is the shared lifecycle-script posture (see `resolveScript`):
 * configured `setup` commands (joined with ` && ` so failures short-circuit;
 * worktree config overrides the main repo's), then `bash .superset/setup.sh`
 * (worktree first, then main repo). Scripts that need the canonical
 * `.superset/` dir read `$SUPERSET_ROOT_PATH`, injected by the v2 terminal
 * env builder. Configured `cwd` is honored via the terminal session.
 *
 * No-op when no source resolves to anything runnable.
 */
export async function startSetupTerminalIfPresent(
	args: StartSetupTerminalArgs,
): Promise<StartSetupTerminalResult> {
	const row = args.ctx.db
		.select({
			worktreePath: workspaces.worktreePath,
			repoPath: projects.repoPath,
			// The inner join guarantees a project row; select its id rather
			// than the (nullable) workspace column.
			projectId: projects.id,
		})
		.from(workspaces)
		.innerJoin(projects, eq(projects.id, workspaces.projectId))
		.where(eq(workspaces.id, args.workspaceId))
		.get();

	if (!row || !row.worktreePath || !row.repoPath) {
		return { terminal: null, warning: null, chained: false };
	}

	const resolved = resolveInitialCommand({
		repoPath: row.repoPath,
		projectId: row.projectId,
		worktreePath: row.worktreePath,
	});
	if (!resolved) {
		return { terminal: null, warning: null, chained: false };
	}

	const terminalId = crypto.randomUUID();
	const completionRoot = managedSetupCompletionRoot();
	const setupStore =
		args.ctx.direct && completionRoot
			? args.ctx.directOperations?.workspaceSetups
			: undefined;
	let setup: WorkspaceSetup | null = null;
	let setupCommand = resolved.initialCommand;
	if (setupStore && completionRoot) {
		try {
			await waitForTerminalBaseEnv();
			const shell = resolveLaunchShell(getTerminalBaseEnv());
			setup = setupStore.begin({
				workspaceId: args.workspaceId,
				terminalId,
				completionTracked: supportsRunCompletion(shell),
				startedAt: Date.now(),
			});
			if (setup.completionTracked)
				setupCommand = new CommandCompletionStore(completionRoot).prepare(
					{ workspaceId: args.workspaceId, operationId: terminalId },
					shell,
					setupCommand,
				);
		} catch (error) {
			const warning =
				`Failed to start setup terminal: ${error instanceof Error ? error.message : String(error)}`.slice(
					0,
					8192,
				);
			if (setup) setupStore.update(setup, { phase: "failed", warning });
			return { terminal: null, warning, chained: false };
		}
	}
	const initialCommand = args.chainCommand
		? `${setupCommand} && ${args.chainCommand}`
		: setupCommand;

	const result = await createTerminalSessionInternal({
		terminalId,
		workspaceId: args.workspaceId,
		db: args.ctx.db,
		eventBus: args.ctx.eventBus,
		initialCommand,
		...(resolved.cwd && { cwd: resolved.cwd }),
	});
	if ("error" in result) {
		const warning = `Failed to start setup terminal: ${result.error}`.slice(
			0,
			8192,
		);
		if (setup && setupStore)
			setupStore.update(setup, {
				phase:
					result.kind === "DAEMON_UNAVAILABLE" || result.transient
						? "unknown"
						: "failed",
				warning,
			});
		return {
			terminal: null,
			warning,
			chained: false,
		};
	}

	if (setup && setupStore) setupStore.update(setup, { phase: "running" });
	return {
		terminal: {
			id: terminalId,
			role: "setup",
			label: "Workspace Setup",
		},
		warning: null,
		chained: Boolean(args.chainCommand),
	};
}

/** Exported for tests. Resolves the initial command for the setup terminal. */
export function resolveInitialCommand(args: {
	repoPath: string;
	projectId: string;
	worktreePath?: string;
	/** Override $HOME for tests. */
	homeDir?: string;
}): { initialCommand: string; cwd?: string } | null {
	const resolved = resolveScript("setup", args);
	if (!resolved) return null;

	const initialCommand =
		resolved.kind === "commands"
			? resolved.commands.join(" && ")
			: `bash ${shellSingleQuote(resolved.scriptPath)}`;
	return { initialCommand, ...(resolved.cwd && { cwd: resolved.cwd }) };
}

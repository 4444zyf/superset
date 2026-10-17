import { createHash } from "node:crypto";
import { buildTerminalCommand } from "@superset/shared/terminal-command";
import { readForegroundProcessState } from "@superset/pty-daemon/process-tree";
import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { projects, workspaces } from "../../../db/schema";
import { managedRunCompletionRoot } from "../../../direct/managed-paths";
import {
	RunCompletionStore,
	supportsRunCompletion,
} from "../../../direct/run-completion";
import {
	getTerminalBaseEnv,
	resolveLaunchShell,
	waitForTerminalBaseEnv,
} from "../../../terminal/env";
import { WorkspaceRunManager } from "../../../direct/workspace-runs";
import { resolveScript, shellSingleQuote } from "../../../runtime/setup/config";
import { connectExistingDaemon } from "../../../terminal/daemon-client-singleton";
import { restoreResources } from "../../../terminal/restore-resources";
import { createTerminalSessionInternal } from "../../../terminal/terminal";
import type { HostServiceContext } from "../../../types";
import { protectedProcedure, router } from "../../index";

const scope = z.object({ workspaceId: z.string().min(1).max(128) });
function requireWorkspace(ctx: HostServiceContext, id: string) {
	if (!ctx.direct || !ctx.directOperations)
		throw new TRPCError({
			code: "PRECONDITION_FAILED",
			message: "Workspace run tracking requires a direct backend.",
		});
	const workspace = ctx.db.query.workspaces
		.findFirst({ where: eq(workspaces.id, id) })
		.sync();
	if (!workspace || workspace.archivedAt !== null)
		throw new TRPCError({ code: "NOT_FOUND", message: "Workspace not found." });
	const project = workspace.projectId
		? ctx.db.query.projects
				.findFirst({ where: eq(projects.id, workspace.projectId) })
				.sync()
		: null;
	if (workspace.projectId && (!project || project.deletedAt !== null))
		throw new TRPCError({ code: "NOT_FOUND", message: "Project not found." });
	return { workspace, project, store: ctx.directOperations.workspaceRuns };
}
function definitionFor(target: ReturnType<typeof requireWorkspace>) {
	if (!target.project) return null;
	const resolved = resolveScript("run", {
		repoPath: target.project.repoPath,
		projectId: target.project.id,
		worktreePath: target.workspace.worktreePath,
	});
	if (!resolved) return null;
	const commands =
		resolved.kind === "commands"
			? resolved.commands
			: [`bash ${shellSingleQuote(resolved.scriptPath)}`];
	if (commands.join("\n").length > 128 * 1024)
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: "The run command exceeds 128 KiB.",
		});
	return {
		source: "project-config" as const,
		projectId: target.project.id,
		commands,
		...(resolved.cwd ? { cwd: resolved.cwd } : {}),
	};
}
const versionOf = (definition: ReturnType<typeof definitionFor>) =>
	definition
		? createHash("sha256").update(JSON.stringify(definition)).digest("hex")
		: null;
function managerFor(
	ctx: HostServiceContext,
	store: ReturnType<typeof requireWorkspace>["store"],
) {
	const completionRoot = managedRunCompletionRoot();
	const completion = completionRoot
		? new RunCompletionStore(completionRoot)
		: null;
	return new WorkspaceRunManager(store, {
		async launch(run) {
			let initialCommand = buildTerminalCommand(run.commands) ?? undefined;
			if (run.completionTracked && completion) {
				await waitForTerminalBaseEnv();
				initialCommand = completion.prepare(
					run,
					resolveLaunchShell(getTerminalBaseEnv()),
					initialCommand ?? "",
				);
			}
			const result = await createTerminalSessionInternal({
				terminalId: run.terminalId,
				workspaceId: run.workspaceId,
				initialCommand,
				cwd: run.cwd,
				db: ctx.db,
				eventBus: ctx.eventBus,
			});
			if ("error" in result)
				throw new TRPCError({
					code: "INTERNAL_SERVER_ERROR",
					message: result.error,
				});
		},
		async probe(run) {
			const [resource] = await restoreResources(ctx, [
				{
					workspaceId: run.workspaceId,
					resourceId: run.terminalId,
					kind: "terminal",
				},
			]);
			if (resource?.state === "unknown") return { state: "unknown" };
			if (resource?.state !== "live") return { state: "gone" };
			const daemon = await connectExistingDaemon();
			try {
				const session = (await daemon.list()).find(
					(item) => item.id === run.terminalId,
				);
				if (!session?.alive) return { state: "gone" };
				if (!session.executionId) return { state: "unknown" };
				return {
					state: "live",
					executionId: session.executionId,
					foreground: readForegroundProcessState(session.pid),
					...(run.completionTracked && completion
						? { exitCode: completion.read(run) ?? undefined }
						: {}),
				};
			} finally {
				await daemon.dispose();
			}
		},
		async signal(run, force) {
			if (!run.executionId)
				throw new TRPCError({
					code: "PRECONDITION_FAILED",
					message: "The terminal execution is unknown.",
				});
			const daemon = await connectExistingDaemon();
			try {
				if (force || !run.foregroundSeen)
					await daemon.closeExisting(
						run.terminalId,
						run.executionId,
						force ? "SIGKILL" : "SIGINT",
					);
				else
					daemon.inputExisting(
						run.terminalId,
						run.executionId,
						Buffer.from("\u0003"),
					);
			} finally {
				await daemon.dispose();
			}
		},
	});
}

export const workspaceRunRouter = router({
	getStateV1: protectedProcedure.input(scope).query(async ({ ctx, input }) => {
		const target = requireWorkspace(ctx, input.workspaceId);
		const run = await managerFor(ctx, target.store).read(input.workspaceId);
		let definition: ReturnType<typeof definitionFor> = null;
		let definitionError: string | null = null;
		try {
			definition = definitionFor(target);
		} catch (error) {
			definitionError =
				error instanceof Error
					? error.message
					: "The run definition is unavailable.";
		}
		return {
			projectId: target.project?.id ?? null,
			definition,
			definitionVersion: versionOf(definition),
			definitionError,
			run,
		};
	}),
	startV1: protectedProcedure
		.input(
			scope.extend({
				operationId: z.string().uuid(),
				definitionVersion: z.string().regex(/^[a-f0-9]{64}$/),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const target = requireWorkspace(ctx, input.workspaceId);
			const definition = definitionFor(target);
			if (!definition || versionOf(definition) !== input.definitionVersion)
				throw new TRPCError({
					code: "CONFLICT",
					message: "The run command changed. Refresh before starting it.",
				});
			let completionTracked = false;
			if (managedRunCompletionRoot()) {
				await waitForTerminalBaseEnv();
				completionTracked = supportsRunCompletion(
					resolveLaunchShell(getTerminalBaseEnv()),
				);
			}
			return managerFor(ctx, target.store).start({
				completionTracked,
				workspaceId: input.workspaceId,
				operationId: input.operationId,
				terminalId: input.operationId,
				commands: definition.commands,
				cwd: definition.cwd,
				startedAt: Date.now(),
			});
		}),
	stopV1: protectedProcedure
		.input(
			scope.extend({
				operationId: z.string().uuid(),
				runOperationId: z.string().uuid(),
				executionId: z.string().min(1).max(128),
				force: z.boolean().default(false),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const target = requireWorkspace(ctx, input.workspaceId);
			return managerFor(ctx, target.store).stop(
				input.workspaceId,
				input.runOperationId,
				input.executionId,
				input.force,
			);
		}),
});

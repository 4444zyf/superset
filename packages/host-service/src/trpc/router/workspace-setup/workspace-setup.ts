import { TRPCError } from "@trpc/server";
import { readForegroundProcessState } from "@superset/pty-daemon/process-tree";
import { connectExistingDaemon } from "../../../terminal/daemon-client-singleton";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { workspaces } from "../../../db/schema";
import { managedSetupCompletionRoot } from "../../../direct/managed-paths";
import { RunCompletionStore as CommandCompletionStore } from "../../../direct/run-completion";
import { readWorkspaceSetupStatus } from "../../../direct/workspace-setups";
import { restoreResources } from "../../../terminal/restore-resources";
import { protectedProcedure, router } from "../../index";
export const workspaceSetupRouter = router({
	getStateV1: protectedProcedure
		.input(z.object({ workspaceId: z.string().min(1).max(128) }))
		.query(async ({ ctx, input }) => {
			if (!ctx.direct || !ctx.directOperations)
				throw new TRPCError({
					code: "PRECONDITION_FAILED",
					message: "Setup status requires a direct backend",
				});
			const workspace = ctx.db.query.workspaces
				.findFirst({ where: eq(workspaces.id, input.workspaceId) })
				.sync();
			if (!workspace || workspace.archivedAt !== null)
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "Workspace not found",
				});
			return readWorkspaceSetupStatus(
				ctx.directOperations.workspaceSetups,
				input.workspaceId,
				async (setup) => {
					const [resource] = await restoreResources(ctx, [
						{
							workspaceId: setup.workspaceId,
							resourceId: setup.terminalId,
							kind: "terminal",
							...(setup.executionId ? { executionId: setup.executionId } : {}),
						},
					]);
					if (resource?.state !== "live" || !resource.executionId)
						return { state: "unknown" };
					const root = managedSetupCompletionRoot();
					const exitCode =
						root && setup.completionTracked
							? new CommandCompletionStore(root).read({
									workspaceId: setup.workspaceId,
									operationId: setup.terminalId,
								})
							: null;
					let foreground: boolean | null = null;
					if (setup.cancelRequested) {
						const daemon = await connectExistingDaemon();
						try {
							const current = (await daemon.list()).find(
								(s) => s.id === setup.terminalId,
							);
							if (
								current?.alive &&
								current.executionId === resource.executionId
							)
								foreground = readForegroundProcessState(current.pid);
						} finally {
							await daemon.dispose();
						}
					}
					return {
						state: "live",
						foreground,
						executionId: resource.executionId,
						...(exitCode !== null ? { exitCode } : {}),
					};
				},
			);
		}),
});

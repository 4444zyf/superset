import os from "node:os";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { createResolveCwd } from "../../../chat-v3/resolveCwd";
import { directAgentProfiles } from "../../../direct/agent-environment";
import { directChatHarnesses } from "../../../direct/chat-readiness";
import {
	beginDirectDrain,
	directMaintenanceStatus,
} from "../../../direct/maintenance";
import { managedSetupCompletionRoot } from "../../../direct/managed-paths";
import { runTerminalScriptOperation } from "../../../direct/terminal-script-operation";
import { runTerminalAgentFeedbackOperation } from "../../../direct/terminal-agent-feedback-operation";
import { currentDirectAgentHookUrl } from "../../../direct/agent-hook-url";
import {
	DirectBrowserBridgeError,
	type DirectBrowserReadBridge,
} from "../../../direct/browser-read-bridge";
import { browserBridgeReadOperationSchema } from "@superset/shared/browser-bridge";
import { HOST_SERVICE_VERSION } from "../../../install-source";
import { supportsWorkspaceRestore } from "../../../terminal/restore-resources";
import type { DirectBackendIdentity, HostServiceContext } from "../../../types";
import { protectedProcedure, router } from "../../index";

export function describeDirectBackend(
	identity: DirectBackendIdentity | undefined,
	durableOperations = false,
	workspaceViewRestoreV1 = false,
	browserReads?: Pick<DirectBrowserReadBridge, "isReady">,
) {
	if (!identity)
		throw new TRPCError({
			code: "PRECONDITION_FAILED",
			message: "This host is not a direct backend",
		});
	return {
		...identity,
		runtimeMode: "direct" as const,
		protocolVersion: 1 as const,
		version: HOST_SERVICE_VERSION,
		platform: os.platform(),
		arch: os.arch(),
		cloudAccountRequired: false,
		chatHarnesses: directChatHarnesses(),
		capabilities: {
			workstationBrowserReadBridgeConnectV1: browserReads !== undefined,
			workstationBrowserReadBridgeV1: browserReads?.isReady() === true,
			workstationAgentHooksV1:
				durableOperations &&
				workspaceViewRestoreV1 &&
				currentDirectAgentHookUrl() !== null,
			workstationAgentFeedbackV1: durableOperations && workspaceViewRestoreV1,
			workspaceViewRestoreV1,
			workstationFilesV1: true,
			workstationPortsV1: true,
			workstationFileEventsV1: true,
			workstationGitV1: true,
			workstationGitIdentityV1: true,
			workstationGitHistoryV1: true,
			workstationGitSyncV1: true,
			workstationManagedWorktreesV1: true,
			workstationProjectsV1: true,
			workstationProjectScriptsV1: true,
			workstationWorkspaceRunV1: workspaceViewRestoreV1,
			workstationWorkspaceRunV2: durableOperations && workspaceViewRestoreV1,
			workstationTerminalPresetsV1: durableOperations && workspaceViewRestoreV1,
			workstationAgentSettingsV1: true,
			workstationAgentManagementV1: true,
			workstationAgentCatalogV2: true,
			workstationAgentCatalogReadV1: true,
			workstationTerminalScriptsV1: true,
			workstationTerminalScriptExecutionV1:
				durableOperations && workspaceViewRestoreV1,
			workstationWorkspaceCleanupV1: durableOperations,
			workstationWorkspaceSetupV1:
				durableOperations && managedSetupCompletionRoot() !== null,
			projects: true,
			sessions: true,
			terminals: true,
			chat: true,
			files: true,
			attachments: true,
			workstationChatAttachmentInputV1: Boolean(
				directAgentProfiles() && process.env.HOST_MANIFEST_DIR,
			),
			git: true,
			durableOperations,
			relay: false,
			cloudTasks: false,
			cloudPageWatch: false,
			hostedMcp: false,
		},
	};
}

const directProcedures = z.enum([
	"workspaceCleanup.destroyTrackedV1",
	"workspaceRun.startV1",
	"workspaceRun.startV2",
	"workspaceRun.stopV1",
	"project.create",
	"workspaceCreation.createSession",
	"workspaces.createSession",
	"workspaces.create",
	"agents.run",
	"terminal.createSession",
	"terminal.runScriptV1",
	"terminal.sendToAgentV1",
	"terminal.launchSession",
	"chat.createSession",
	"chat.prompt",
	"git.commit",
	"git.push",
	"git.syncBranchV1",
]);

async function dispatch(
	ctx: HostServiceContext,
	procedure: z.infer<typeof directProcedures>,
	input: Record<string, unknown>,
	operationId: string,
): Promise<unknown> {
	if (procedure === "chat.createSession") {
		if (!ctx.runtime.chat)
			throw new TRPCError({
				code: "PRECONDITION_FAILED",
				message: "Chat runtime is unavailable",
			});
		const workspaceId = z.string().min(1).parse(input.workspaceId);
		return ctx.runtime.chat().commands.createSession({
			...input,
			scopeId: workspaceId,
			cwd: createResolveCwd(ctx.db)(workspaceId),
			commandId: operationId,
			sessionId: operationId,
			terminalId: input.terminalId ?? operationId,
		} as never);
	}
	if (procedure === "chat.prompt") {
		if (!ctx.runtime.chat)
			throw new TRPCError({
				code: "PRECONDITION_FAILED",
				message: "Chat runtime is unavailable",
			});
		return ctx.runtime
			.chat()
			.commands.prompt({ ...input, commandId: operationId } as never);
	}
	const { appRouter } = await import("../router");
	const caller = appRouter.createCaller(ctx);
	switch (procedure) {
		case "workspaceCleanup.destroyTrackedV1":
			return caller.workspaceCleanup.destroyTrackedV1(input as never);
		case "workspaceRun.startV1":
			return caller.workspaceRun.startV1({ ...input, operationId } as never);
		case "workspaceRun.startV2":
			return caller.workspaceRun.startV2({ ...input, operationId } as never);
		case "workspaceRun.stopV1":
			return caller.workspaceRun.stopV1({ ...input, operationId } as never);
		case "git.syncBranchV1":
			return caller.git.syncBranchV1(input as never);
		case "git.commit":
			return caller.git.commit(input as never);
		case "git.push":
			return caller.git.push(input as never);
		case "project.create":
			return caller.project.create({
				...input,
				id: input.id ?? operationId,
			} as never);
		case "workspaceCreation.createSession":
		case "workspaces.createSession":
			return caller.workspaces.createSession({
				...input,
				id: input.id ?? operationId,
			} as never);
		case "workspaces.create":
			return caller.workspaces.create({
				...input,
				id: input.id ?? operationId,
			} as never);
		case "terminal.runScriptV1":
			return runTerminalScriptOperation(ctx, input);
		case "terminal.sendToAgentV1":
			return runTerminalAgentFeedbackOperation(ctx, input);
		case "terminal.createSession":
			return caller.terminal.createSession({
				...input,
				terminalId: input.terminalId ?? operationId,
			} as never);
		case "terminal.launchSession":
			return caller.terminal.launchSession({
				...input,
				terminalId: input.terminalId ?? operationId,
			} as never);
		case "agents.run":
			return caller.agents.run({
				...input,
				requestTerminalId: input.requestTerminalId ?? operationId,
			} as never);
	}
}

export const directRouter = router({
	describe: protectedProcedure.query(async ({ ctx }) =>
		describeDirectBackend(
			ctx.direct,
			!!ctx.directOperations,
			await supportsWorkspaceRestore(),
			ctx.directBrowserReads,
		),
	),
	browserReadV1: protectedProcedure
		.input(
			z.discriminatedUnion("type", [
				browserBridgeReadOperationSchema.options[0].strict(),
				browserBridgeReadOperationSchema.options[1].strict(),
			]),
		)
		.query(async ({ ctx, input }) => {
			if (!ctx.direct || !ctx.directBrowserReads?.isReady())
				throw new TRPCError({
					code: "PRECONDITION_FAILED",
					message:
						"This host has no browser panes (no desktop app is attached to it).",
				});
			try {
				return input.type === "list"
					? await ctx.directBrowserReads.listPanes(input.workspaceId)
					: await ctx.directBrowserReads.console(
							input.workspaceId,
							input.paneId,
						);
			} catch (error) {
				if (!(error instanceof DirectBrowserBridgeError)) throw error;
				const codes: Record<
					DirectBrowserBridgeError["kind"],
					TRPCError["code"]
				> = {
					unavailable: "PRECONDITION_FAILED",
					busy: "TOO_MANY_REQUESTS",
					timeout: "NOT_FOUND",
					invalid: "BAD_REQUEST",
					failed: "BAD_REQUEST",
				};
				throw new TRPCError({
					code: codes[error.kind],
					message: error.message,
					cause: error,
				});
			}
		}),
	execute: protectedProcedure
		.input(
			z.object({
				operationId: z.string().uuid(),
				procedure: directProcedures,
				input: z.record(z.string(), z.unknown()),
			}),
		)
		.mutation(({ ctx, input }) => {
			if (!ctx.direct || !ctx.directOperations)
				throw new TRPCError({
					code: "PRECONDITION_FAILED",
					message: "Durable direct operations are unavailable on this host",
				});
			if (!ctx.directOperations.status(input.operationId))
				ctx.directOperations.assertCanCreate();
			return ctx.directOperations.execute(
				input.operationId,
				input.procedure,
				input.input,
				() => dispatch(ctx, input.procedure, input.input, input.operationId),
			);
		}),
	operationStatus: protectedProcedure
		.input(z.object({ operationId: z.string().uuid() }))
		.query(({ ctx, input }) => {
			if (!ctx.direct || !ctx.directOperations)
				throw new TRPCError({
					code: "PRECONDITION_FAILED",
					message: "Durable direct operations are unavailable on this host",
				});
			return ctx.directOperations.status(input.operationId);
		}),
	maintenanceStatus: protectedProcedure.query(({ ctx }) =>
		directMaintenanceStatus(ctx.directOperations, ctx.runtime),
	),
	beginDrain: protectedProcedure
		.input(
			z.object({
				ownerId: z.string().uuid(),
				freeze: z.boolean().optional().default(false),
			}),
		)
		.mutation(({ ctx, input }) =>
			beginDirectDrain(
				input.ownerId,
				input.freeze,
				ctx.directOperations,
				ctx.runtime,
			),
		),
	endDrain: protectedProcedure
		.input(z.object({ ownerId: z.string().uuid() }))
		.mutation(({ ctx, input }) => {
			if (!ctx.directOperations)
				throw new TRPCError({
					code: "PRECONDITION_FAILED",
					message: "Direct backend maintenance is unavailable",
				});
			ctx.directOperations.endDrain(input.ownerId);
			ctx.runtime.activateBackground?.();
			return directMaintenanceStatus(ctx.directOperations, ctx.runtime);
		}),
});

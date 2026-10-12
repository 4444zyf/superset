import os from "node:os";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { createResolveCwd } from "../../../chat-v3/resolveCwd";
import { directChatHarnesses } from "../../../direct/chat-readiness";
import {
	beginDirectDrain,
	directMaintenanceStatus,
} from "../../../direct/maintenance";
import { HOST_SERVICE_VERSION } from "../../../install-source";
import type { DirectBackendIdentity, HostServiceContext } from "../../../types";
import { protectedProcedure, router } from "../../index";

export function describeDirectBackend(
	identity: DirectBackendIdentity | undefined,
	durableOperations = false,
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
			projects: true,
			sessions: true,
			terminals: true,
			chat: true,
			files: true,
			attachments: true,
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
	"project.create",
	"workspaceCreation.createSession",
	"workspaces.createSession",
	"workspaces.create",
	"agents.run",
	"terminal.createSession",
	"terminal.launchSession",
	"chat.createSession",
	"chat.prompt",
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
	describe: protectedProcedure.query(({ ctx }) =>
		describeDirectBackend(ctx.direct, !!ctx.directOperations),
	),
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

import { AGENT_IDENTITY_IDS } from "@superset/shared/agent-catalog";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { connectExistingDaemon } from "../terminal/daemon-client-singleton";
import { restoreResources } from "../terminal/restore-resources";
import { sendAgentMessage } from "../terminal/terminal";
import type { HostServiceContext } from "../types";
import { deliverExistingAgentFeedback } from "./terminal-agent-feedback-delivery";
import { terminalScriptInputSchema } from "./terminal-script-operation";

export const terminalAgentFeedbackInputSchema =
	terminalScriptInputSchema.extend({
		agent: z.strictObject({
			agentId: z.enum(AGENT_IDENTITY_IDS),
			launchId: z.string().min(1).max(128).optional(),
			startedAt: z.number().nonnegative(),
			agentSessionId: z.string().min(1).max(512).optional(),
		}),
	});

export async function runTerminalAgentFeedbackOperation(
	ctx: HostServiceContext,
	value: unknown,
) {
	if (!ctx.direct || !ctx.directOperations)
		throw new TRPCError({
			code: "PRECONDITION_FAILED",
			message: "Durable direct operations are unavailable on this host",
		});
	const input = terminalAgentFeedbackInputSchema.parse(value);
	return deliverExistingAgentFeedback(input, {
		getBinding: () => ctx.terminalAgentStore.get(input.terminalId),
		inspect: async () => {
			const [resource] = await restoreResources(ctx, [
				{
					workspaceId: input.workspaceId,
					resourceId: input.terminalId,
					executionId: input.executionId,
					kind: "terminal",
				},
			]);
			return resource ?? { state: "unknown" };
		},
		connect: connectExistingDaemon,
		frame: (expectedAgent, write) =>
			sendAgentMessage({
				...input,
				submit: true,
				db: ctx.db,
				eventBus: ctx.eventBus,
				expectedAgent,
				executionWrite: write,
				terminalAgentStore: ctx.terminalAgentStore,
			}),
	});
}

import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { connectExistingDaemon } from "../terminal/daemon-client-singleton";
import { restoreResources } from "../terminal/restore-resources";
import { writeFramedInputToExistingExecution } from "../terminal/terminal";
import type { HostServiceContext } from "../types";
import { deliverExistingTerminalScript } from "./terminal-script-delivery";

export const terminalScriptInputSchema = z.strictObject({
	workspaceId: z.string().min(1).max(128),
	terminalId: z.string().min(1).max(128),
	executionId: z.string().min(1).max(128),
	text: z
		.string()
		.min(1)
		.max(4 * 1024 * 1024 + 65536),
});
export async function runTerminalScriptOperation(
	ctx: HostServiceContext,
	value: unknown,
) {
	if (!ctx.direct || !ctx.directOperations)
		throw new TRPCError({
			code: "PRECONDITION_FAILED",
			message: "Durable direct operations are unavailable on this host",
		});
	const input = terminalScriptInputSchema.parse(value);
	return deliverExistingTerminalScript(input, {
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
		frame: (write) =>
			writeFramedInputToExistingExecution(
				{ ...input, submit: true, db: ctx.db, eventBus: ctx.eventBus },
				write,
				ctx.terminalAgentStore,
			),
	});
}

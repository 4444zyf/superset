import { TRPCError } from "@trpc/server";
import { matchesAgentBinding } from "../terminal-agents/matches-agent-binding";
import type { TerminalAgentBinding } from "../terminal-agents/types";
import {
	deliverExistingTerminalScript,
	type ExistingTerminalScriptInput,
	type TerminalScriptDelivery,
} from "./terminal-script-delivery";

export interface AgentFeedbackInput extends ExistingTerminalScriptInput {
	agent: Pick<
		TerminalAgentBinding,
		"agentId" | "launchId" | "startedAt" | "agentSessionId"
	>;
}

export async function deliverExistingAgentFeedback(
	input: AgentFeedbackInput,
	delivery: Omit<TerminalScriptDelivery, "frame"> & {
		getBinding(): TerminalAgentBinding | undefined;
		frame(
			expected: TerminalAgentBinding,
			write: (data: string) => void,
		): ReturnType<TerminalScriptDelivery["frame"]>;
	},
) {
	const binding = delivery.getBinding();
	const unavailable = () =>
		new TRPCError({
			code: "PRECONDITION_FAILED",
			message: "The selected agent is no longer current",
		});
	if (!binding) throw unavailable();
	const expected: TerminalAgentBinding = {
		...binding,
		...input.agent,
		launchId: input.agent.launchId,
		agentSessionId: input.agent.agentSessionId,
		terminalId: input.terminalId,
		workspaceId: input.workspaceId,
	};
	const assertCurrent = () => {
		if (!matchesAgentBinding(delivery.getBinding(), expected))
			throw unavailable();
	};
	assertCurrent();
	return deliverExistingTerminalScript(input, {
		inspect: delivery.inspect,
		connect: delivery.connect,
		frame: (write) => {
			assertCurrent();
			return delivery.frame(expected, write);
		},
	});
}

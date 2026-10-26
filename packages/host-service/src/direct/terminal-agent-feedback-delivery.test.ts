import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import type { TerminalAgentBinding } from "../terminal-agents/types";
import { DirectOperationStore, type OperationDatabase } from "./operations";
import {
	deliverExistingAgentFeedback,
	type AgentFeedbackInput,
} from "./terminal-agent-feedback-delivery";

const input: AgentFeedbackInput = {
	workspaceId: "workspace",
	terminalId: "terminal",
	executionId: "execution",
	text: "change the selected element",
	agent: {
		agentId: "claude",
		launchId: "launch",
		startedAt: 1,
		agentSessionId: "session",
	},
};
function fixture() {
	let current: TerminalAgentBinding | undefined = {
		...input.agent,
		terminalId: input.terminalId,
		workspaceId: input.workspaceId,
		lastEventAt: 2,
		lastEventType: "Start",
	};
	let connected = 0,
		frames = 0,
		disposed = 0,
		listed = 0,
		loseConfirmation = false;
	const writes: string[] = [];
	const inspected = Promise.withResolvers<{
		state: string;
		executionId: string;
	}>();
	const delivery = {
		getBinding: () => current,
		inspect: () => inspected.promise,
		connect: async () => {
			connected++;
			return {
				list: async () => {
					if (++listed > 1 && loseConfirmation)
						throw Error("confirmation lost");
					return [
						{
							id: input.terminalId,
							executionId: input.executionId,
							alive: true,
						},
					];
				},
				inputExisting: (_id: string, _execution: string, data: Buffer) =>
					writes.push(data.toString()),
				dispose: async () => {
					disposed++;
				},
			};
		},
		frame: async (
			expected: TerminalAgentBinding,
			write: (data: string) => void,
		) => {
			frames++;
			expect(expected.launchId).toBe("launch");
			write(input.text);
			return { success: true as const };
		},
	};
	return {
		delivery,
		inspected,
		writes,
		stats: () => ({ connected, frames, disposed }),
		replace: (binding?: TerminalAgentBinding) => {
			current = binding;
		},
		current: () => current!,
		loseConfirmation: () => {
			loseConfirmation = true;
		},
	};
}

test("agent feedback pins its active binding and original terminal execution", async () => {
	const f = fixture();
	f.inspected.resolve({ state: "live", executionId: "execution" });
	expect(await deliverExistingAgentFeedback(input, f.delivery)).toEqual({
		terminalId: "terminal",
		executionId: "execution",
		submitted: true,
	});
	expect(f.writes).toEqual([input.text]);
	expect(f.stats()).toEqual({ connected: 1, frames: 1, disposed: 1 });
});

test("a target without a live agent cannot fall through to a shell", async () => {
	const f = fixture();
	f.replace();
	await expect(deliverExistingAgentFeedback(input, f.delivery)).rejects.toThrow(
		"The selected agent is no longer current",
	);
	expect(f.stats()).toEqual({ connected: 0, frames: 0, disposed: 0 });
	expect(f.writes).toEqual([]);
});

test("feedback for another workspace cannot reach the current agent", async () => {
	const f = fixture();
	f.replace({ ...f.current(), workspaceId: "other" });
	await expect(deliverExistingAgentFeedback(input, f.delivery)).rejects.toThrow(
		"The selected agent is no longer current",
	);
	expect(f.writes).toEqual([]);
	expect(f.stats().connected).toBe(0);
});

test("an agent that ends while terminal inspection is pending receives no input", async () => {
	const f = fixture();
	const result = deliverExistingAgentFeedback(input, f.delivery);
	f.replace({ ...f.current(), endedAt: 3 });
	f.inspected.resolve({ state: "live", executionId: "execution" });
	await expect(result).rejects.toThrow(
		"The selected agent is no longer current",
	);
	expect(f.writes).toEqual([]);
	expect(f.stats().disposed).toBe(1);
});

test("a replacement launch in the same terminal does not receive old feedback", async () => {
	const f = fixture();
	const result = deliverExistingAgentFeedback(input, f.delivery);
	f.replace({ ...f.current(), launchId: "replacement" });
	f.inspected.resolve({ state: "live", executionId: "execution" });
	await expect(result).rejects.toThrow(
		"The selected agent is no longer current",
	);
	expect(f.writes).toEqual([]);
});

test("a switched harness session within the same launch does not receive old feedback", async () => {
	const f = fixture();
	f.replace({ ...f.current(), agentSessionId: "replacement-session" });
	await expect(deliverExistingAgentFeedback(input, f.delivery)).rejects.toThrow(
		"The selected agent is no longer current",
	);
	expect(f.writes).toEqual([]);
});

test("lost confirmation keeps feedback unresolved and cannot send the same operation again", async () => {
	const db = new Database(":memory:");
	try {
		const operations = new DirectOperationStore(
			db as unknown as OperationDatabase,
			"instance",
		);
		const f = fixture();
		f.loseConfirmation();
		f.inspected.resolve({ state: "live", executionId: "execution" });
		const id = crypto.randomUUID(),
			send = () => deliverExistingAgentFeedback(input, f.delivery);
		await expect(
			operations.execute(id, "terminal.sendToAgentV1", input, send),
		).rejects.toThrow("confirmation lost");
		expect(operations.status(id)?.status).toBe("unresolved");
		await expect(
			operations.execute(id, "terminal.sendToAgentV1", input, send),
		).rejects.toThrow("unresolved");
		expect(f.writes).toEqual([input.text]);
		expect(f.stats().frames).toBe(1);
	} finally {
		db.close();
	}
});

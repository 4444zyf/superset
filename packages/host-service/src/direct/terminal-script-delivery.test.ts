import { Database } from "bun:sqlite";
import { afterEach, expect, test } from "bun:test";
import { DirectOperationStore, type OperationDatabase } from "./operations";
import {
	deliverExistingTerminalScript,
	type TerminalScriptDelivery,
} from "./terminal-script-delivery";

const close: (() => void)[] = [];
afterEach(() => {
	for (const fn of close.splice(0)) fn();
});
const input = {
	workspaceId: "workspace",
	terminalId: "terminal",
	executionId: "execution",
	text: "printf '中文'",
};
function fixture() {
	const writes: { id: string; executionId: string; text: string }[] = [];
	let inspected = { state: "live", executionId: "execution" },
		listed = { id: "terminal", executionId: "execution", alive: true },
		enumerations = 0,
		disposed = 0,
		frames = 0,
		failConfirmation = false;
	const delivery: TerminalScriptDelivery = {
		inspect: async () => inspected,
		connect: async () => ({
			list: async () => {
				enumerations++;
				if (failConfirmation && enumerations > 1)
					throw new Error("confirmation lost");
				return [listed];
			},
			inputExisting: (id, executionId, data) => {
				writes.push({ id, executionId, text: data.toString() });
			},
			dispose: async () => {
				disposed++;
			},
		}),
		frame: async (write) => {
			frames++;
			write(input.text);
			write("\r");
			return { success: true };
		},
	};
	return {
		delivery,
		writes,
		changed: () => {
			inspected = { state: "interrupted", executionId: "new-execution" };
		},
		staleDaemon: () => {
			listed = { ...listed, executionId: "new-execution" };
		},
		loseConfirmation: () => {
			failConfirmation = true;
		},
		frames: () => frames,
		disposed: () => disposed,
	};
}
test("existing script input uses the checked execution for every frame and confirms submission", async () => {
	const f = fixture();
	expect(await deliverExistingTerminalScript(input, f.delivery)).toEqual({
		terminalId: "terminal",
		executionId: "execution",
		submitted: true,
	});
	expect(f.writes).toEqual([
		{ id: "terminal", executionId: "execution", text: input.text },
		{ id: "terminal", executionId: "execution", text: "\r" },
	]);
	expect(f.disposed()).toBe(1);
});
test("an unavailable or replaced execution receives no script text", async () => {
	const f = fixture();
	f.changed();
	await expect(
		deliverExistingTerminalScript(input, f.delivery),
	).rejects.toThrow();
	expect(f.frames()).toBe(0);
	expect(f.writes).toEqual([]);
});
test("the daemon is checked again before input instead of trusting an earlier resource reply", async () => {
	const f = fixture();
	f.staleDaemon();
	await expect(
		deliverExistingTerminalScript(input, f.delivery),
	).rejects.toThrow();
	expect(f.frames()).toBe(0);
	expect(f.disposed()).toBe(1);
});
test("a lost input confirmation leaves the durable command unresolved and cannot resend it", async () => {
	const db = new Database(":memory:");
	close.push(() => db.close());
	const operations = new DirectOperationStore(
		db as unknown as OperationDatabase,
		"instance",
	);
	const f = fixture();
	f.loseConfirmation();
	const id = crypto.randomUUID();
	await expect(
		operations.execute(id, "terminal.runScriptV1", input, () =>
			deliverExistingTerminalScript(input, f.delivery),
		),
	).rejects.toThrow("confirmation lost");
	expect(operations.status(id)?.status).toBe("unresolved");
	await expect(
		operations.execute(id, "terminal.runScriptV1", input, () =>
			deliverExistingTerminalScript(input, f.delivery),
		),
	).rejects.toThrow("unresolved");
	expect(f.frames()).toBe(1);
	expect(f.writes).toHaveLength(2);
});

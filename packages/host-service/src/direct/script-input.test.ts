import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { DirectOperationStore } from "./operations";
import { observeScriptInput } from "./script-input";
import { WorkspaceRunManager } from "./workspace-runs";
import { readWorkspaceSetupStatus } from "./workspace-setups";
const ref = {
	workspaceId: "workspace",
	resourceId: "terminal",
	executionId: "execution",
};
test("a scoped Ctrl+C cancels queued delivery and releases a run only after its execution is idle", async () => {
	const db = new Database(":memory:");
	try {
		const ops = new DirectOperationStore(db, "backend");
		const run = ops.workspaceRuns.reserve({
			workspaceId: "workspace",
			operationId: "operation",
			terminalId: "terminal",
			commands: ["sleep 120"],
			startedAt: 1,
			completionTracked: true,
		});
		ops.workspaceRuns.update(run, {
			state: "active",
			executionId: "execution",
			foregroundSeen: true,
		});
		const cancelled: string[] = [];
		observeScriptInput(ops, ref, "\x03", (id, workspaceId) => {
			cancelled.push(`${workspaceId}/${id}`);
		});
		expect(cancelled).toEqual(["workspace/terminal"]);
		let foreground = true;
		const manager = new WorkspaceRunManager(ops.workspaceRuns, {
			launch: async () => {
				throw new Error("must not launch");
			},
			probe: async () => ({
				state: "live",
				executionId: "execution",
				foreground,
			}),
			signal: async () => {
				throw new Error("must not send another signal");
			},
		});
		expect((await manager.read("workspace"))?.state).toBe("stop-requested");
		foreground = false;
		expect((await manager.read("workspace"))?.state).toBe("ended");
	} finally {
		db.close();
	}
});
test("a Ctrl+C for another execution or ordinary pasted text cannot cancel a queued setup", () => {
	const db = new Database(":memory:");
	try {
		const ops = new DirectOperationStore(db, "backend");
		const setup = ops.workspaceSetups.begin({
			workspaceId: "workspace",
			terminalId: "terminal",
			startedAt: 1,
			completionTracked: true,
		});
		ops.workspaceSetups.update(setup, {
			phase: "running",
			executionId: "execution",
		});
		let cancelled = 0;
		observeScriptInput(ops, { ...ref, executionId: "old" }, "\x03", () => {
			cancelled++;
		});
		observeScriptInput(ops, ref, "text\x03", () => {
			cancelled++;
		});
		expect(cancelled).toBe(0);
		expect(
			ops.workspaceSetups.get("workspace")?.cancelRequested,
		).toBeUndefined();
	} finally {
		db.close();
	}
});
test("an explicitly interrupted setup is cancelled on idle without inventing an exit code", async () => {
	const db = new Database(":memory:");
	try {
		const ops = new DirectOperationStore(db, "backend");
		const setup = ops.workspaceSetups.begin({
			workspaceId: "workspace",
			terminalId: "terminal",
			startedAt: 1,
			completionTracked: true,
		});
		ops.workspaceSetups.update(setup, {
			phase: "running",
			executionId: "execution",
		});
		observeScriptInput(ops, ref, "\x03", () => {});
		expect(
			await readWorkspaceSetupStatus(
				ops.workspaceSetups,
				"workspace",
				async () => ({
					state: "live",
					executionId: "execution",
					foreground: false,
				}),
			),
		).toMatchObject({ phase: "cancelled", cancelRequested: true });
		expect(ops.workspaceSetups.get("workspace")?.exitCode).toBeUndefined();
	} finally {
		db.close();
	}
});

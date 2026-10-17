import { TRPCError } from "@trpc/server";
import type { OperationDatabase } from "./operations";

export interface WorkspaceSetup {
	workspaceId: string;
	terminalId: string;
	startedAt: number;
	completionTracked: boolean;
	phase:
		| "launching"
		| "running"
		| "succeeded"
		| "failed"
		| "unknown"
		| "cancelled";
	executionId?: string;
	exitCode?: number;
	warning?: string;
	cancelRequested?: boolean;
}
export class WorkspaceSetupStore {
	constructor(
		private readonly db: OperationDatabase,
		private readonly capacity = 4096,
	) {
		db.exec(
			"CREATE TABLE IF NOT EXISTS direct_workspace_setups (workspace_id TEXT PRIMARY KEY, record_json TEXT NOT NULL)",
		);
	}
	get(workspaceId: string): WorkspaceSetup | null {
		const row = this.db
			.prepare(
				"SELECT record_json FROM direct_workspace_setups WHERE workspace_id = ?",
			)
			.get(workspaceId) as { record_json: string } | undefined;
		return row ? JSON.parse(row.record_json) : null;
	}
	begin(
		input: Pick<
			WorkspaceSetup,
			"workspaceId" | "terminalId" | "startedAt" | "completionTracked"
		>,
	): WorkspaceSetup {
		const setup: WorkspaceSetup = { ...input, phase: "launching" };
		const json = JSON.stringify(setup);
		if (Buffer.byteLength(json) > 64 * 1024)
			throw new TRPCError({
				code: "BAD_REQUEST",
				message: "Setup status exceeds 64 KiB",
			});
		this.db.exec("BEGIN IMMEDIATE");
		try {
			if (
				!this.get(input.workspaceId) &&
				(
					this.db
						.prepare("SELECT COUNT(*) AS count FROM direct_workspace_setups")
						.get() as { count: number }
				).count >= this.capacity
			)
				throw new TRPCError({
					code: "PRECONDITION_FAILED",
					message: "The setup status store is full",
				});
			this.db
				.prepare(
					"INSERT INTO direct_workspace_setups (workspace_id,record_json) VALUES (?,?) ON CONFLICT(workspace_id) DO UPDATE SET record_json=excluded.record_json",
				)
				.run(input.workspaceId, json);
			this.db.exec("COMMIT");
			return setup;
		} catch (error) {
			this.db.exec("ROLLBACK");
			throw error;
		}
	}
	update(
		setup: WorkspaceSetup,
		patch: Partial<
			Pick<
				WorkspaceSetup,
				"phase" | "executionId" | "exitCode" | "warning" | "cancelRequested"
			>
		>,
	): WorkspaceSetup | null {
		const next = {
			...setup,
			...patch,
			...(patch.warning !== undefined
				? { warning: patch.warning.slice(0, 8192) }
				: {}),
		};
		if (Buffer.byteLength(JSON.stringify(next)) > 64 * 1024)
			throw new TRPCError({
				code: "BAD_REQUEST",
				message: "Setup status exceeds 64 KiB",
			});
		this.db
			.prepare(
				"UPDATE direct_workspace_setups SET record_json = ? WHERE workspace_id = ? AND record_json = ?",
			)
			.run(JSON.stringify(next), setup.workspaceId, JSON.stringify(setup));
		return this.get(setup.workspaceId);
	}
	remove(workspaceId: string): void {
		this.db
			.prepare("DELETE FROM direct_workspace_setups WHERE workspace_id = ?")
			.run(workspaceId);
	}
}
type SetupProbe =
	| { state: "unknown" }
	| {
			state: "live";
			executionId: string;
			exitCode?: number;
			foreground?: boolean | null;
	  };
export async function readWorkspaceSetupStatus(
	store: WorkspaceSetupStore,
	workspaceId: string,
	probe: (setup: WorkspaceSetup) => Promise<SetupProbe>,
): Promise<WorkspaceSetup | null> {
	const setup = store.get(workspaceId);
	if (
		!setup ||
		setup.phase === "failed" ||
		setup.phase === "succeeded" ||
		setup.phase === "cancelled"
	)
		return setup;
	const current = await probe(setup);
	if (
		current.state !== "live" ||
		(setup.executionId && setup.executionId !== current.executionId)
	)
		return store.update(setup, { phase: "unknown" });
	if (current.exitCode !== undefined)
		return store.update(setup, {
			phase:
				setup.cancelRequested && current.exitCode === 130
					? "cancelled"
					: current.exitCode === 0
						? "succeeded"
						: "failed",
			exitCode: current.exitCode,
			executionId: current.executionId,
			warning: undefined,
		});
	if (setup.cancelRequested && current.foreground === false)
		return store.update(setup, {
			phase: "cancelled",
			executionId: current.executionId,
			warning: undefined,
		});
	return store.update(setup, {
		phase: setup.completionTracked ? "running" : "unknown",
		executionId: current.executionId,
		warning: undefined,
	});
}

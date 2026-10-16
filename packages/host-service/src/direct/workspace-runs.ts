import { TRPCError } from "@trpc/server";
import type { OperationDatabase } from "./operations";

export interface WorkspaceRunInput {
	workspaceId: string;
	operationId: string;
	terminalId: string;
	commands: string[];
	cwd?: string;
	startedAt: number;
}
export interface WorkspaceRun extends WorkspaceRunInput {
	state: "starting" | "active" | "stop-requested" | "ended" | "unknown";
	executionId?: string;
	foregroundSeen: boolean;
}
export type RunProbe =
	| { state: "live"; executionId: string; foreground: boolean | null }
	| { state: "gone" }
	| { state: "unknown" };

export class WorkspaceRunStore {
	constructor(
		private readonly db: OperationDatabase,
		private readonly capacity = 4096,
	) {
		db.exec(
			"CREATE TABLE IF NOT EXISTS direct_workspace_runs (workspace_id TEXT PRIMARY KEY, operation_id TEXT NOT NULL, record_json TEXT NOT NULL)",
		);
	}
	get(workspaceId: string): WorkspaceRun | null {
		const row = this.db
			.prepare(
				"SELECT record_json FROM direct_workspace_runs WHERE workspace_id = ?",
			)
			.get(workspaceId) as { record_json: string } | undefined;
		return row ? JSON.parse(row.record_json) : null;
	}
	reserve(input: WorkspaceRunInput): WorkspaceRun {
		if (Buffer.byteLength(JSON.stringify(input)) > 256 * 1024)
			throw new TRPCError({
				code: "BAD_REQUEST",
				message: "The workspace run metadata exceeds 256 KiB.",
			});
		this.db.exec("BEGIN IMMEDIATE");
		try {
			const previous = this.get(input.workspaceId);
			if (
				previous &&
				(previous.state !== "ended" ||
					previous.operationId === input.operationId)
			)
				throw new TRPCError({
					code: "CONFLICT",
					message:
						"A workspace run is already active or unresolved. Inspect or stop it before starting another.",
				});
			if (
				!previous &&
				(
					this.db
						.prepare("SELECT COUNT(*) AS count FROM direct_workspace_runs")
						.get() as { count: number }
				).count >= this.capacity
			)
				throw new TRPCError({
					code: "PRECONDITION_FAILED",
					message: "The workspace run store is full.",
				});
			const run: WorkspaceRun = {
				...input,
				state: "starting",
				foregroundSeen: false,
			};
			this.db
				.prepare(
					"INSERT INTO direct_workspace_runs (workspace_id,operation_id,record_json) VALUES (?,?,?) ON CONFLICT(workspace_id) DO UPDATE SET operation_id=excluded.operation_id,record_json=excluded.record_json",
				)
				.run(input.workspaceId, input.operationId, JSON.stringify(run));
			this.db.exec("COMMIT");
			return run;
		} catch (error) {
			this.db.exec("ROLLBACK");
			throw error;
		}
	}
	update(
		run: WorkspaceRun,
		patch: Partial<
			Pick<WorkspaceRun, "state" | "executionId" | "foregroundSeen">
		>,
	): WorkspaceRun {
		const next = { ...run, ...patch };
		this.db
			.prepare(
				"UPDATE direct_workspace_runs SET record_json = ? WHERE workspace_id = ? AND operation_id = ? AND record_json = ?",
			)
			.run(
				JSON.stringify(next),
				run.workspaceId,
				run.operationId,
				JSON.stringify(run),
			);
		return this.get(run.workspaceId) ?? next;
	}
}

export class WorkspaceRunManager {
	constructor(
		private readonly store: WorkspaceRunStore,
		private readonly runtime: {
			launch(run: WorkspaceRun): Promise<void>;
			probe(run: WorkspaceRun): Promise<RunProbe>;
			signal(run: WorkspaceRun, force: boolean): Promise<void>;
		},
	) {}
	async read(workspaceId: string): Promise<WorkspaceRun | null> {
		const run = this.store.get(workspaceId);
		if (!run || run.state === "ended") return run;
		const probe = await this.runtime.probe(run);
		if (probe.state === "unknown") return run;
		if (probe.state === "gone") {
			if (run.state === "starting" || run.state === "unknown") return run;
			return this.store.update(run, { state: "ended" });
		}
		if (run.executionId && run.executionId !== probe.executionId)
			return this.store.update(run, { state: "unknown" });
		if (run.state === "starting" || run.state === "unknown")
			return this.store.update(run, {
				state: "unknown",
				executionId: probe.executionId,
			});
		if (
			probe.foreground === false &&
			(run.state === "stop-requested" || run.foregroundSeen)
		)
			return this.store.update(run, { state: "ended" });
		return probe.foreground === true && !run.foregroundSeen
			? this.store.update(run, { foregroundSeen: true })
			: run;
	}
	async start(input: WorkspaceRunInput): Promise<WorkspaceRun> {
		await this.read(input.workspaceId);
		const run = this.store.reserve(input);
		try {
			await this.runtime.launch(run);
			const probe = await this.runtime.probe(run);
			const current = this.store.get(input.workspaceId) ?? run;
			if (current.operationId !== run.operationId)
				throw new TRPCError({
					code: "CONFLICT",
					message: "This run was superseded.",
				});
			if (current.state === "ended" || current.state === "stop-requested")
				return current;
			if (probe.state === "live") {
				if (current.executionId && current.executionId !== probe.executionId)
					return this.store.update(current, { state: "unknown" });
				return this.store.update(current, {
					state: "active",
					executionId: probe.executionId,
					foregroundSeen: current.foregroundSeen || probe.foreground === true,
				});
			}
			return this.store.update(current, {
				state: probe.state === "gone" ? "ended" : "unknown",
			});
		} catch (error) {
			this.store.update(run, { state: "unknown" });
			throw error;
		}
	}
	async stop(
		workspaceId: string,
		operationId: string,
		executionId: string,
		force: boolean,
	): Promise<WorkspaceRun> {
		const run = this.store.get(workspaceId);
		if (
			!run ||
			run.operationId !== operationId ||
			run.executionId !== executionId
		)
			throw new TRPCError({
				code: "CONFLICT",
				message: "The workspace run changed. Refresh before stopping it.",
			});
		if (run.state === "ended") return run;
		const probe = await this.runtime.probe(run);
		if (probe.state !== "live" || probe.executionId !== executionId)
			throw new TRPCError({
				code: "CONFLICT",
				message:
					"The run execution is unavailable or changed. No signal was sent.",
			});
		this.store.update(run, { state: "stop-requested" });
		await this.runtime.signal(run, force);
		return (await this.read(workspaceId)) ?? run;
	}
}

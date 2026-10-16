import { createHash } from "node:crypto";
import { TRPCError } from "@trpc/server";
import superjson from "superjson";
import { WorkspaceRunStore } from "./workspace-runs";

export interface OperationDatabase {
	exec(sql: string): unknown;
	prepare(sql: string): {
		run(...values: unknown[]): unknown;
		get(...values: unknown[]): unknown;
	};
}

export interface DirectOperationReceipt {
	operationId: string;
	procedure: string;
	status: "accepted" | "completed" | "failed" | "unresolved";
	result?: unknown;
	error?: { code: string; message: string };
	entityIds?: Record<string, string>;
}

interface OperationRow {
	operation_id: string;
	procedure: string;
	input_hash: string;
	status: DirectOperationReceipt["status"];
	result_json: string | null;
	error_json: string | null;
}

function canonical(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(canonical);
	if (value && typeof value === "object")
		return Object.fromEntries(
			Object.entries(value)
				.filter(([, item]) => item !== undefined)
				.sort(([a], [b]) => a.localeCompare(b))
				.map(([key, item]) => [key, canonical(item)]),
		);
	return value;
}

export function directChatSessionId(commandId: string): string {
	const hash = createHash("sha256")
		.update(`superset-direct-chat:${commandId}`)
		.digest("hex");
	return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

export class DirectOperationStore {
	private readonly pending = new Map<string, Promise<DirectOperationReceipt>>();
	private readonly pendingCommands = new Map<string, unknown>();
	private activeCreates = 0;
	readonly workspaceRuns: WorkspaceRunStore;

	constructor(
		private readonly db: OperationDatabase,
		private readonly instanceId: string,
		private readonly capacity = 100_000,
	) {
		this.workspaceRuns = new WorkspaceRunStore(db);
		db.exec(
			"CREATE TABLE IF NOT EXISTS direct_operations (operation_id TEXT PRIMARY KEY, procedure TEXT NOT NULL, input_hash TEXT NOT NULL, instance_id TEXT NOT NULL, status TEXT NOT NULL, result_json TEXT, error_json TEXT, accepted_at INTEGER NOT NULL)",
		);
		db.prepare(
			"UPDATE direct_operations SET status = 'unresolved' WHERE status = 'accepted' AND instance_id != ?",
		).run(instanceId);
		db.exec(
			"CREATE TABLE IF NOT EXISTS direct_maintenance (id INTEGER PRIMARY KEY CHECK (id = 1), mode TEXT NOT NULL, owner_id TEXT); INSERT OR IGNORE INTO direct_maintenance (id, mode, owner_id) VALUES (1, 'active', NULL)",
		);
		db.exec(
			"CREATE TABLE IF NOT EXISTS direct_operation_entities (operation_id TEXT PRIMARY KEY, identifiers_json TEXT NOT NULL)",
		);
		db.exec(
			"CREATE TABLE IF NOT EXISTS direct_freeze (id INTEGER PRIMARY KEY CHECK (id = 1), frozen INTEGER NOT NULL); INSERT OR IGNORE INTO direct_freeze (id, frozen) VALUES (1, 0)",
		);
	}

	maintenance(): {
		mode: "active" | "draining";
		ownerId: string | null;
		frozen: boolean;
	} {
		const row = this.db
			.prepare("SELECT mode, owner_id FROM direct_maintenance WHERE id = 1")
			.get() as { mode: "active" | "draining"; owner_id: string | null };
		const freeze = this.db
			.prepare("SELECT frozen FROM direct_freeze WHERE id = 1")
			.get() as { frozen: number };
		return {
			mode: row.mode,
			ownerId: row.owner_id,
			frozen: freeze.frozen === 1,
		};
	}

	beginDrain(ownerId: string, freeze = false): void {
		const current = this.maintenance();
		if (current.ownerId && current.ownerId !== ownerId)
			throw new TRPCError({
				code: "CONFLICT",
				message: "Another maintenance owner is draining this backend",
			});
		this.transaction(() => {
			this.db
				.prepare(
					"UPDATE direct_maintenance SET mode = 'draining', owner_id = ? WHERE id = 1",
				)
				.run(ownerId);
			if (freeze)
				this.db
					.prepare("UPDATE direct_freeze SET frozen = 1 WHERE id = 1")
					.run();
		});
	}

	endDrain(ownerId: string): void {
		const current = this.maintenance();
		if (current.ownerId && current.ownerId !== ownerId)
			throw new TRPCError({
				code: "CONFLICT",
				message: "Only the maintenance owner may end this drain",
			});
		this.transaction(() => {
			this.db
				.prepare(
					"UPDATE direct_maintenance SET mode = 'active', owner_id = NULL WHERE id = 1",
				)
				.run();
			this.db.prepare("UPDATE direct_freeze SET frozen = 0 WHERE id = 1").run();
		});
	}

	private transaction<T>(write: () => T): T {
		this.db.exec("BEGIN IMMEDIATE");
		try {
			const result = write();
			this.db.exec("COMMIT");
			return result;
		} catch (error) {
			this.db.exec("ROLLBACK");
			throw error;
		}
	}

	assertCanCreate(): void {
		if (this.maintenance().mode === "draining")
			throw new TRPCError({
				code: "PRECONDITION_FAILED",
				message:
					"The backend is draining for maintenance; existing work continues",
			});
	}

	get activeCreateOperations(): number {
		const row = this.db
			.prepare(
				"SELECT count(*) AS count FROM direct_operations WHERE status = 'accepted'",
			)
			.get() as { count: number };
		return this.activeCreates + row.count;
	}

	async runMutationOperation<T>(execute: () => Promise<T>): Promise<T> {
		if (this.maintenance().frozen)
			throw new TRPCError({
				code: "PRECONDITION_FAILED",
				message: "The backend is frozen for maintenance",
			});
		this.activeCreates++;
		try {
			return await execute();
		} finally {
			this.activeCreates--;
		}
	}

	async runCreateOperation<T>(execute: () => Promise<T>): Promise<T> {
		this.assertCanCreate();
		this.activeCreates++;
		try {
			return await execute();
		} finally {
			this.activeCreates--;
		}
	}

	private row(operationId: string): OperationRow | undefined {
		return this.db
			.prepare("SELECT * FROM direct_operations WHERE operation_id = ?")
			.get(operationId) as OperationRow | undefined;
	}

	status(operationId: string): DirectOperationReceipt | null {
		const row = this.row(operationId);
		if (!row) return null;
		const entities = this.db
			.prepare(
				"SELECT identifiers_json FROM direct_operation_entities WHERE operation_id = ?",
			)
			.get(operationId) as { identifiers_json: string } | undefined;
		return {
			operationId: row.operation_id,
			procedure: row.procedure,
			status: row.status,
			...(entities ? { entityIds: JSON.parse(entities.identifiers_json) } : {}),
			...(row.result_json === null
				? {}
				: { result: superjson.parse(row.result_json) }),
			...(row.error_json === null ? {} : { error: JSON.parse(row.error_json) }),
		};
	}

	runCommand<T>(commandId: string, input: unknown, execute: () => T): T {
		const operationId = `chat:${commandId}`;
		const procedure = `chat.${commandId.split(":")[0]}`;
		const inputHash = createHash("sha256")
			.update(JSON.stringify(canonical(input)))
			.digest("hex");
		const existing = this.row(operationId);
		if (existing) {
			if (existing.procedure !== procedure || existing.input_hash !== inputHash)
				throw new TRPCError({
					code: "CONFLICT",
					message:
						"This command ID has already been accepted with different inputs",
				});
			if (this.pendingCommands.has(operationId))
				return this.pendingCommands.get(operationId) as T;
			if (existing.status === "completed")
				return this.status(operationId)!.result as T;
			throw new TRPCError({
				code: "PRECONDITION_FAILED",
				message: `This command is ${existing.status}; reconcile the existing remote work before creating a new command`,
			});
		}
		this.accept(operationId, procedure, inputHash, input);
		const complete = (value: unknown) => {
			this.db
				.prepare(
					"UPDATE direct_operations SET status = 'completed', result_json = ? WHERE operation_id = ? AND instance_id = ? AND status = 'accepted'",
				)
				.run(superjson.stringify(value), operationId, this.instanceId);
			return value;
		};
		const unresolved = (error: unknown): never => {
			const stored = {
				code: error instanceof TRPCError ? error.code : "INTERNAL_SERVER_ERROR",
				message: error instanceof Error ? error.message : "Command failed",
			};
			this.db
				.prepare(
					"UPDATE direct_operations SET status = 'unresolved', error_json = ? WHERE operation_id = ? AND instance_id = ? AND status = 'accepted'",
				)
				.run(JSON.stringify(stored), operationId, this.instanceId);
			throw error;
		};
		try {
			const result = execute();
			if (result && typeof (result as { then?: unknown }).then === "function") {
				const pending = Promise.resolve(result)
					.then(complete, unresolved)
					.finally(() => this.pendingCommands.delete(operationId));
				this.pendingCommands.set(operationId, pending);
				return pending as T;
			}
			return complete(result) as T;
		} catch (error) {
			return unresolved(error);
		}
	}

	private accept(
		operationId: string,
		procedure: string,
		inputHash: string,
		input: unknown,
	): void {
		const count = this.db
			.prepare("SELECT count(*) AS count FROM direct_operations")
			.get() as { count: number };
		if (count.count >= this.capacity)
			throw new TRPCError({
				code: "PRECONDITION_FAILED",
				message:
					"The durable operation journal is full; preserve the existing receipts before maintenance",
			});
		const payload =
			input && typeof input === "object"
				? (input as Record<string, unknown>)
				: {};
		const entityIds: Record<string, string> = {};
		if (typeof payload.workspaceId === "string")
			entityIds.workspaceId = payload.workspaceId;
		if (procedure === "project.create")
			entityIds.projectId =
				typeof payload.id === "string" ? payload.id : operationId;
		if (
			procedure.startsWith("workspaces.") ||
			procedure === "workspaceCreation.createSession"
		)
			entityIds.workspaceId =
				typeof payload.id === "string" ? payload.id : operationId;
		if (procedure.startsWith("terminal."))
			entityIds.terminalId =
				typeof payload.terminalId === "string"
					? payload.terminalId
					: operationId;
		if (procedure === "agents.run")
			entityIds.terminalId =
				typeof payload.requestTerminalId === "string"
					? payload.requestTerminalId
					: operationId;
		if (procedure === "chat.createSession")
			entityIds.chatSessionId =
				typeof payload.sessionId === "string" ? payload.sessionId : operationId;
		if (procedure.startsWith("chat.") && typeof payload.sessionId === "string")
			entityIds.chatSessionId = payload.sessionId;
		this.transaction(() => {
			this.db
				.prepare(
					"INSERT INTO direct_operations (operation_id, procedure, input_hash, instance_id, status, accepted_at) VALUES (?, ?, ?, ?, 'accepted', ?)",
				)
				.run(operationId, procedure, inputHash, this.instanceId, Date.now());
			this.db
				.prepare(
					"INSERT INTO direct_operation_entities (operation_id, identifiers_json) VALUES (?, ?)",
				)
				.run(operationId, JSON.stringify(entityIds));
		});
	}

	execute(
		operationId: string,
		procedure: string,
		input: unknown,
		execute: () => unknown | Promise<unknown>,
	): Promise<DirectOperationReceipt> {
		const inputHash = createHash("sha256")
			.update(JSON.stringify(canonical(input)))
			.digest("hex");
		const existing = this.row(operationId);
		if (existing) {
			if (existing.procedure !== procedure || existing.input_hash !== inputHash)
				return Promise.reject(
					new TRPCError({
						code: "CONFLICT",
						message:
							"This operation ID has already been accepted with different inputs",
					}),
				);
			const running = this.pending.get(operationId);
			if (running) return running;
			if (existing.status === "completed")
				return Promise.resolve(this.status(operationId)!);
			return Promise.reject(
				new TRPCError({
					code: "PRECONDITION_FAILED",
					message: `This operation is ${existing.status}; inspect its status and reconcile the existing remote work before creating a new operation`,
				}),
			);
		}
		try {
			this.accept(operationId, procedure, inputHash, input);
		} catch (error) {
			return Promise.reject(error);
		}
		const running = (async () => {
			await Promise.resolve();
			try {
				const result = await execute();
				this.db
					.prepare(
						"UPDATE direct_operations SET status = 'completed', result_json = ? WHERE operation_id = ? AND instance_id = ? AND status = 'accepted'",
					)
					.run(superjson.stringify(result), operationId, this.instanceId);
				return this.status(operationId)!;
			} catch (error) {
				const stored = {
					code:
						error instanceof TRPCError ? error.code : "INTERNAL_SERVER_ERROR",
					message: error instanceof Error ? error.message : "Operation failed",
				};
				this.db
					.prepare(
						"UPDATE direct_operations SET status = 'unresolved', error_json = ? WHERE operation_id = ? AND instance_id = ? AND status = 'accepted'",
					)
					.run(JSON.stringify(stored), operationId, this.instanceId);
				throw error;
			} finally {
				this.pending.delete(operationId);
			}
		})();
		this.pending.set(operationId, running);
		return running;
	}
}

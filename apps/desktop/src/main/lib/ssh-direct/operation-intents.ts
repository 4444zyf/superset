import { chmodSync } from "node:fs";
import type { SqliteDatabase } from "@superset/direct-connection";
import BetterSqlite from "better-sqlite3";

export interface OperationIntent {
	connectionId: string;
	backendId: string;
	namespaceId: string;
	operationId: string;
	procedure: string;
	inputHash: string;
}

export class OperationIntents {
	private readonly db: SqliteDatabase;
	constructor(database: string | SqliteDatabase) {
		this.db =
			typeof database === "string" ? new BetterSqlite(database) : database;
		if (typeof database === "string") chmodSync(database, 0o600);
		this.db.exec(
			"CREATE TABLE IF NOT EXISTS operation_intents (connectionId TEXT NOT NULL, backendId TEXT NOT NULL, namespaceId TEXT NOT NULL, operationId TEXT PRIMARY KEY, procedure TEXT NOT NULL, inputHash TEXT NOT NULL)",
		);
	}

	list(connectionId: string): OperationIntent[] {
		return this.db
			.prepare(
				"SELECT connectionId, backendId, namespaceId, operationId, procedure, inputHash FROM operation_intents WHERE connectionId = ?",
			)
			.all(connectionId) as OperationIntent[];
	}

	begin(operation: OperationIntent): void {
		this.db.exec("BEGIN IMMEDIATE");
		try {
			const existing = this.db
				.prepare(
					"SELECT connectionId, backendId, namespaceId, operationId, procedure, inputHash FROM operation_intents WHERE operationId = ?",
				)
				.get(operation.operationId) as OperationIntent | undefined;
			if (existing) {
				if (
					Object.keys(operation).some(
						(key) =>
							existing[key as keyof OperationIntent] !==
							operation[key as keyof OperationIntent],
					)
				)
					throw new Error("Operation identity or input changed");
			} else {
				if (this.list(operation.connectionId).length)
					throw new Error(
						"Reconcile the pending operation before starting another mutation",
					);
				const count = this.db
					.prepare("SELECT COUNT(*) AS count FROM operation_intents")
					.get() as { count: number };
				if (count.count >= 4096)
					throw new Error(
						"Pending operation journal is full; reconcile outstanding operations",
					);
				this.db
					.prepare("INSERT INTO operation_intents VALUES (?, ?, ?, ?, ?, ?)")
					.run(
						operation.connectionId,
						operation.backendId,
						operation.namespaceId,
						operation.operationId,
						operation.procedure,
						operation.inputHash,
					);
			}
			this.db.exec("COMMIT");
		} catch (error) {
			this.db.exec("ROLLBACK");
			throw error;
		}
	}

	resolve(connectionId: string, operationId: string): void {
		this.db
			.prepare(
				"DELETE FROM operation_intents WHERE connectionId = ? AND operationId = ?",
			)
			.run(connectionId, operationId);
	}

	close(): void {
		this.db.close();
	}
}

import { chmodSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { SqliteDatabase } from "@superset/direct-connection";
import BetterSqlite from "better-sqlite3";
import {
	validateWorkspaceView,
	type WorkspaceViewSnapshot,
} from "../../../shared/workspace-view";

export class WorkspaceViewStore {
	private readonly db: SqliteDatabase;
	private owner: string | null = null;
	constructor(
		database: string | SqliteDatabase,
		private readonly now = Date.now,
	) {
		if (typeof database === "string") {
			mkdirSync(dirname(database), { recursive: true, mode: 0o700 });
			this.db = new BetterSqlite(database);
			chmodSync(database, 0o600);
		} else this.db = database;
		this.db.exec(
			"PRAGMA synchronous=FULL; BEGIN IMMEDIATE; CREATE TABLE IF NOT EXISTS workspace_view (id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL, snapshot TEXT); INSERT OR IGNORE INTO workspace_view VALUES(1,0,NULL); COMMIT;",
		);
	}
	activateOwner(owner: string | null): void {
		this.owner = owner;
	}
	read(): {
		revision: number;
		snapshot: WorkspaceViewSnapshot | null;
		invalid: boolean;
	} {
		const row = this.db
			.prepare("SELECT revision, snapshot FROM workspace_view WHERE id=1")
			.get() as { revision: number; snapshot: string | null };
		if (row.snapshot === null)
			return { revision: row.revision, snapshot: null, invalid: false };
		try {
			const data = JSON.parse(row.snapshot);
			if (
				data.schemaVersion !== 1 ||
				data.revision !== row.revision ||
				!Number.isSafeInteger(data.updatedAt)
			)
				throw new Error("Invalid workspace view version");
			const { schemaVersion: _, revision: __, updatedAt: ___, ...input } = data;
			return {
				revision: row.revision,
				snapshot: {
					...validateWorkspaceView(input),
					schemaVersion: 1,
					revision: row.revision,
					updatedAt: data.updatedAt,
				},
				invalid: false,
			};
		} catch {
			return { revision: row.revision, snapshot: null, invalid: true };
		}
	}
	private write(
		owner: string,
		expectedRevision: number,
		snapshot: string | null,
	): number {
		if (!this.owner || this.owner !== owner)
			throw new Error("Workspace view owner changed");
		if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0)
			throw new Error("Invalid workspace view revision");
		this.db.exec("BEGIN IMMEDIATE");
		try {
			const row = this.db
				.prepare("SELECT revision FROM workspace_view WHERE id=1")
				.get() as { revision: number };
			if (row.revision !== expectedRevision)
				throw new Error("Workspace view revision changed");
			this.db
				.prepare("UPDATE workspace_view SET revision=?,snapshot=? WHERE id=1")
				.run(expectedRevision + 1, snapshot);
			this.db.exec("COMMIT");
			return expectedRevision + 1;
		} catch (error) {
			this.db.exec("ROLLBACK");
			throw error;
		}
	}
	save(input: {
		owner: string;
		expectedRevision: number;
		view: unknown;
	}): WorkspaceViewSnapshot {
		if (this.read().invalid)
			throw new Error(
				"The saved workspace view must be cleared before writing",
			);
		const snapshot: WorkspaceViewSnapshot = {
			...validateWorkspaceView(input.view),
			schemaVersion: 1,
			revision: input.expectedRevision + 1,
			updatedAt: this.now(),
		};
		this.write(input.owner, input.expectedRevision, JSON.stringify(snapshot));
		return snapshot;
	}
	forget(input: { owner: string; expectedRevision: number }): number {
		return this.write(input.owner, input.expectedRevision, null);
	}
	close(): void {
		this.db.close();
	}
}

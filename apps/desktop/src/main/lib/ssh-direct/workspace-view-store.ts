import { chmodSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { SqliteDatabase } from "@superset/direct-connection";
import BetterSqlite from "better-sqlite3";
import {
	type TargetView,
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
		this.db.exec(
			"CREATE TABLE IF NOT EXISTS local_namespace_views (identity TEXT PRIMARY KEY, snapshot TEXT NOT NULL)",
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
		beforeWrite?: () => void,
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
			beforeWrite?.();
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
		return this.write(input.owner, input.expectedRevision, null, () => {
			this.db.exec("DELETE FROM local_namespace_views");
		});
	}
	removeLocalNamespace(
		owner: string,
		connectionId: string,
		namespaceId: string,
	): void {
		if (this.owner !== owner) throw new Error("Workspace view owner changed");
		this.db
			.prepare(
				"DELETE FROM local_namespace_views WHERE json_extract(identity,'$[0]')=? AND json_extract(identity,'$[2]')=?",
			)
			.run(connectionId, namespaceId);
	}
	selectLocalNamespace(
		owner: string,
		identity: Pick<
			TargetView,
			| "connectionId"
			| "targetRevision"
			| "backendId"
			| "namespaceId"
			| "serviceUid"
		>,
	): void {
		if (this.owner !== owner) throw new Error("Workspace view owner changed");
		const previous = this.read();
		if (previous.invalid)
			throw new Error(
				"The saved workspace view must be cleared before writing",
			);
		if (!previous.snapshot) return;
		const key = (target: typeof identity) =>
			JSON.stringify([
				target.connectionId,
				target.backendId,
				target.namespaceId,
				target.serviceUid,
			]);
		const old = previous.snapshot.targets.find(
			(t) => t.connectionId === identity.connectionId,
		);
		if (old && key(old) === key(identity)) return;
		const archived = this.db
			.prepare("SELECT snapshot FROM local_namespace_views WHERE identity=?")
			.get(key(identity)) as { snapshot: string } | undefined;
		const {
			schemaVersion: _,
			revision: __,
			updatedAt: ___,
			...input
		} = previous.snapshot;
		input.targets = input.targets.filter(
			(t) => t.connectionId !== identity.connectionId,
		);
		if (archived) {
			const target = JSON.parse(archived.snapshot) as TargetView;
			if (key(target) !== key(identity))
				throw new Error("Local view identity changed");
			input.targets.push({ ...target, ...identity, autoConnect: false });
		}
		if (!old && !archived) return;
		if (input.activeConnectionId === identity.connectionId)
			input.activeConnectionId = null;
		const snapshot: WorkspaceViewSnapshot = {
			...validateWorkspaceView(input),
			schemaVersion: 1,
			revision: previous.revision + 1,
			updatedAt: this.now(),
		};
		this.write(owner, previous.revision, JSON.stringify(snapshot), () => {
			if (!old) return;
			const count = this.db
				.prepare("SELECT COUNT(*) AS count FROM local_namespace_views")
				.get() as { count: number };
			if (
				count.count >= 64 &&
				!this.db
					.prepare(
						"SELECT identity FROM local_namespace_views WHERE identity=?",
					)
					.get(key(old))
			)
				throw new Error("Local namespace view limit exceeded");
			this.db
				.prepare(
					"INSERT INTO local_namespace_views VALUES (?,?) ON CONFLICT(identity) DO UPDATE SET snapshot=excluded.snapshot",
				)
				.run(key(old), JSON.stringify(old));
		});
	}
	close(): void {
		this.db.close();
	}
}

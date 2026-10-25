import { chmodSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { SqliteDatabase } from "@superset/direct-connection";
import BetterSqlite from "better-sqlite3";
import {
	type TargetView,
	validateWorkspaceView,
	type WorkspaceViewSnapshot,
} from "../../../shared/workspace-view";
import {
	hasBrowserPanes,
	projectWorkspaceViewV1,
	validateWorkspaceViewV2,
	type WorkspaceViewInputV2,
	type WorkspaceViewSnapshotV2,
} from "../../../shared/workspace-view-v2";
import { mergeLegacyWorkspaceView } from "./workspace-view-legacy-merge";

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
	private readStored(): {
		revision: number;
		snapshot: WorkspaceViewSnapshot | WorkspaceViewSnapshotV2 | null;
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
				(data.schemaVersion !== 1 && data.schemaVersion !== 2) ||
				data.revision !== row.revision ||
				!Number.isSafeInteger(data.updatedAt)
			)
				throw new Error("Invalid workspace view version");
			const { schemaVersion: _, revision: __, updatedAt: ___, ...input } = data;
			return {
				revision: row.revision,
				snapshot: {
					...(data.schemaVersion === 1
						? validateWorkspaceView(input)
						: validateWorkspaceViewV2(input)),
					schemaVersion: data.schemaVersion,
					revision: row.revision,
					updatedAt: data.updatedAt,
				},
				invalid: false,
			};
		} catch {
			return { revision: row.revision, snapshot: null, invalid: true };
		}
	}
	read(): {
		revision: number;
		snapshot: WorkspaceViewSnapshot | null;
		invalid: boolean;
	} {
		const saved = this.readStored();
		if (!saved.snapshot || saved.snapshot.schemaVersion === 1)
			return { ...saved, snapshot: saved.snapshot };
		const { schemaVersion: _, revision, updatedAt, ...view } = saved.snapshot;
		return {
			...saved,
			snapshot: {
				...projectWorkspaceViewV1(view),
				schemaVersion: 1,
				revision,
				updatedAt,
			},
		};
	}
	readV2(): {
		revision: number;
		snapshot: WorkspaceViewSnapshotV2 | null;
		invalid: boolean;
	} {
		const saved = this.readStored();
		return {
			...saved,
			snapshot: saved.snapshot ? { ...saved.snapshot, schemaVersion: 2 } : null,
		};
	}
	private persist(
		owner: string,
		expectedRevision: number,
		view: WorkspaceViewInputV2,
		beforeWrite?: () => void,
	): WorkspaceViewSnapshotV2 {
		const snapshot: WorkspaceViewSnapshotV2 = {
			...view,
			schemaVersion: 2,
			revision: expectedRevision + 1,
			updatedAt: this.now(),
		};
		const stored = hasBrowserPanes(view)
			? snapshot
			: {
					...projectWorkspaceViewV1(view),
					schemaVersion: 1,
					revision: snapshot.revision,
					updatedAt: snapshot.updatedAt,
				};
		this.write(owner, expectedRevision, JSON.stringify(stored), beforeWrite);
		return snapshot;
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
		const previous = this.readV2();
		if (previous.invalid)
			throw new Error(
				"The saved workspace view must be cleared before writing",
			);
		const view = validateWorkspaceView(input.view);
		const previousInput = previous.snapshot
			? (({ schemaVersion: _, revision: __, updatedAt: ___, ...rest }) => rest)(
					previous.snapshot,
				)
			: null;
		const merged =
			previousInput && hasBrowserPanes(previousInput)
				? mergeLegacyWorkspaceView(previousInput, view)
				: view;
		const snapshot = this.persist(input.owner, input.expectedRevision, merged);
		const { schemaVersion: _, revision, updatedAt, ...saved } = snapshot;
		return {
			...projectWorkspaceViewV1(saved),
			schemaVersion: 1,
			revision,
			updatedAt,
		};
	}
	saveV2(input: {
		owner: string;
		expectedRevision: number;
		view: unknown;
	}): WorkspaceViewSnapshotV2 {
		if (this.readV2().invalid)
			throw new Error(
				"The saved workspace view must be cleared before writing",
			);
		return this.persist(
			input.owner,
			input.expectedRevision,
			validateWorkspaceViewV2(input.view),
		);
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
		const previous = this.readV2();
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
			const target = validateWorkspaceViewV2({
				...input,
				activeConnectionId: null,
				targets: [JSON.parse(archived.snapshot)],
			}).targets[0];
			if (!target) throw new Error("Local view identity changed");
			if (key(target) !== key(identity))
				throw new Error("Local view identity changed");
			input.targets.push({ ...target, ...identity, autoConnect: false });
		}
		if (!old && !archived) return;
		if (input.activeConnectionId === identity.connectionId)
			input.activeConnectionId = null;
		this.persist(
			owner,
			previous.revision,
			validateWorkspaceViewV2(input),
			() => {
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
			},
		);
	}
	close(): void {
		this.db.close();
	}
}

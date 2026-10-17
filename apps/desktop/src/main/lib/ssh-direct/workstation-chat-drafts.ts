import { chmodSync } from "node:fs";
import type { SqliteDatabase } from "@superset/direct-connection";
import BetterSqlite from "better-sqlite3";
import { z } from "zod";
import {
	type ChatDraftTarget,
	chatDraftEntriesSchema,
	hasChatDraftsForTarget,
	MAX_CHAT_DRAFT_STORAGE_BYTES,
	type WorkstationChatDraftSnapshot,
	type WorkstationChatDraftUpdate,
} from "../../../shared/workstation-chat-drafts";
export class WorkstationChatDrafts {
	private readonly db: SqliteDatabase;
	constructor(database: string | SqliteDatabase) {
		this.db =
			typeof database === "string" ? new BetterSqlite(database) : database;
		if (typeof database === "string") chmodSync(database, 0o600);
		this.db.exec(
			"CREATE TABLE IF NOT EXISTS workstation_chat_drafts (id INTEGER PRIMARY KEY CHECK(id=1), schemaVersion INTEGER NOT NULL, revision INTEGER NOT NULL, data TEXT NOT NULL)",
		);
	}
	read(): WorkstationChatDraftSnapshot {
		const row = this.db
			.prepare(
				`SELECT schemaVersion,revision,CASE WHEN length(CAST(data AS BLOB))<=${MAX_CHAT_DRAFT_STORAGE_BYTES} THEN data ELSE NULL END AS data FROM workstation_chat_drafts WHERE id=1`,
			)
			.get() as
			| { schemaVersion: number; revision: number; data: string | null }
			| undefined;
		if (!row) return { revision: 0, invalid: false, entries: [] };
		const revision =
			Number.isSafeInteger(row.revision) && row.revision >= 0
				? row.revision
				: 0;
		if (
			row.schemaVersion !== 1 ||
			revision !== row.revision ||
			typeof row.data !== "string"
		)
			return { revision, invalid: true, entries: [] };
		try {
			return {
				revision,
				invalid: false,
				entries: chatDraftEntriesSchema.parse(JSON.parse(row.data)),
			};
		} catch {
			return { revision, invalid: true, entries: [] };
		}
	}
	update(input: WorkstationChatDraftUpdate): WorkstationChatDraftSnapshot {
		const parsed = z
			.object({
				expectedRevision: z
					.number()
					.int()
					.nonnegative()
					.max(Number.MAX_SAFE_INTEGER - 1),
				entries: chatDraftEntriesSchema,
			})
			.strict()
			.parse(input);
		this.db.exec("BEGIN IMMEDIATE");
		try {
			const current = this.read();
			if (current.invalid)
				throw new Error(
					"Chat draft storage is invalid; retained drafts cannot be overwritten",
				);
			if (current.revision !== parsed.expectedRevision)
				throw new Error("Chat drafts changed; reload before saving");
			const revision = current.revision + 1;
			this.db
				.prepare(
					"INSERT INTO workstation_chat_drafts (id,schemaVersion,revision,data) VALUES (1,1,?,?) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,data=excluded.data",
				)
				.run(revision, JSON.stringify(parsed.entries));
			this.db.exec("COMMIT");
			return { revision, invalid: false, entries: parsed.entries };
		} catch (error) {
			this.db.exec("ROLLBACK");
			throw error;
		}
	}
	hasDrafts(target: ChatDraftTarget): boolean {
		const snapshot = this.read();
		return snapshot.invalid || hasChatDraftsForTarget(snapshot.entries, target);
	}

	close() {
		this.db.close();
	}
}

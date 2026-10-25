import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { v4 as uuidv4 } from "uuid";

export type DownloadState =
	| "progressing"
	| "completed"
	| "cancelled"
	| "interrupted";

/**
 * Downloads table - tracks files downloaded through the in-app browser pane
 */
export const downloads = sqliteTable(
	"downloads",
	{
		id: text("id")
			.primaryKey()
			.$defaultFn(() => uuidv4()),
		url: text("url").notNull(),
		filename: text("filename").notNull(),
		savePath: text("save_path").notNull(),
		mimeType: text("mime_type"),
		totalBytes: integer("total_bytes"),
		receivedBytes: integer("received_bytes").notNull().default(0),
		state: text("state").notNull().$type<DownloadState>(),
		startedAt: integer("started_at")
			.notNull()
			.$defaultFn(() => Date.now()),
		completedAt: integer("completed_at"),
	},
	(table) => [index("downloads_started_at_idx").on(table.startedAt)],
);

export type InsertDownload = typeof downloads.$inferInsert;
export type SelectDownload = typeof downloads.$inferSelect;

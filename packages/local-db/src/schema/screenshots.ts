import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { v4 as uuidv4 } from "uuid";

/**
 * Screenshots table - tracks page captures taken from the in-app browser
 * pane's overflow menu. The PNG lives on disk; this row is metadata plus a
 * small thumbnail so a gallery can render without reading every file.
 */
export const screenshots = sqliteTable(
	"screenshots",
	{
		id: text("id")
			.primaryKey()
			.$defaultFn(() => uuidv4()),
		url: text("url").notNull(),
		filename: text("filename").notNull(),
		savePath: text("save_path").notNull(),
		width: integer("width").notNull(),
		height: integer("height").notNull(),
		thumbnail: text("thumbnail").notNull(),
		capturedAt: integer("captured_at")
			.notNull()
			.$defaultFn(() => Date.now()),
	},
	(table) => [index("screenshots_captured_at_idx").on(table.capturedAt)],
);

export type InsertScreenshot = typeof screenshots.$inferInsert;
export type SelectScreenshot = typeof screenshots.$inferSelect;

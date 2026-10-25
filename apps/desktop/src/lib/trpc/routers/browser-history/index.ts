import { TRPCError } from "@trpc/server";
import { session } from "electron";
import { createBrowserHistoryRepository } from "main/lib/browser/browser-history-repository";
import { importCookiesIntoSession } from "main/lib/browser/chrome-cookie-import";
import {
	listChromeImportSources,
	readHistoryFromProfile,
	resolveImportProfile,
	resolveImportSource,
} from "main/lib/browser/chrome-history-import";
import { hasUnreadableChromiumBrowser } from "main/lib/browser/chromium-profiles";
import { localDb } from "main/lib/local-db";
import { z } from "zod";
import { publicProcedure, router } from "../..";

/** The partition the in-app browser pane (and app renderer) use. */
const BROWSER_PARTITION = "persist:superset";

export const createBrowserHistoryRouter = () => {
	const history = createBrowserHistoryRepository(localDb);
	return router({
		getAll: publicProcedure.query(() => history.getAll()),

		search: publicProcedure
			.input(
				z.object({
					query: z.string(),
					// Autocomplete callers keep the default; the History dialog asks
					// for more since it searches the whole table, not just recents.
					limit: z.number().int().min(1).max(200).optional(),
				}),
			)
			.query(({ input }) => history.search(input)),

		upsert: publicProcedure
			.input(
				z.object({
					url: z.string(),
					title: z.string(),
					faviconUrl: z.string().nullable().optional(),
				}),
			)
			.mutation(({ input }) => {
				try {
					history.upsert(input);
				} catch (error) {
					if ((error as { code?: string }).code !== "SQLITE_FULL") {
						throw error;
					}
					throw new TRPCError({
						code: "PRECONDITION_FAILED",
						message: error instanceof Error ? error.message : String(error),
					});
				}
			}),

		clear: publicProcedure.mutation(() => {
			history.clear();
		}),

		/**
		 * Lists Chromium profiles (Chrome, Brave, Arc, …) whose history can be
		 * imported. Chrome's data dir is normally readable without Full Disk
		 * Access; we only hint at FDA when a browser is installed but its profile
		 * directory can't be read.
		 */
		getImportSources: publicProcedure.query(() => {
			const sources = listChromeImportSources();
			if (sources.length > 0) {
				return { needsFullDiskAccess: false, sources };
			}
			return {
				needsFullDiskAccess:
					process.platform === "darwin" && hasUnreadableChromiumBrowser(),
				sources,
			};
		}),

		/**
		 * Imports browsing history from one Chromium profile into our own history
		 * store, merging with anything already there. Returns how many rows were
		 * read from the source.
		 */
		importFromSource: publicProcedure
			.input(z.object({ sourceId: z.string() }))
			.mutation(async ({ input }) => {
				const profileDir = resolveImportSource(input.sourceId);
				if (!profileDir) {
					throw new TRPCError({
						code: "NOT_FOUND",
						message: "That browser profile is no longer available.",
					});
				}

				let entries: Awaited<ReturnType<typeof readHistoryFromProfile>>;
				try {
					entries = await readHistoryFromProfile(profileDir);
				} catch (error) {
					throw new TRPCError({
						code: "INTERNAL_SERVER_ERROR",
						message:
							error instanceof Error
								? `Could not read browser history: ${error.message}`
								: "Could not read browser history.",
					});
				}

				if (entries.length === 0) return { imported: 0 };

				try {
					history.importEntries(entries);
				} catch (error) {
					if ((error as { code?: string }).code === "SQLITE_FULL") {
						throw new TRPCError({
							code: "PRECONDITION_FAILED",
							message:
								"Not enough space to import history. Clear some history and try again.",
						});
					}
					throw error;
				}

				return { imported: entries.length };
			}),

		/**
		 * Imports logins (cookies) from one Chromium profile into the in-app
		 * browser's session, so sites the user is signed into carry over. macOS
		 * only (needs the browser's Keychain key); returns 0 elsewhere or when the
		 * key is denied. Superset's own hosts are never imported.
		 */
		importCookiesFromSource: publicProcedure
			.input(z.object({ sourceId: z.string() }))
			.mutation(async ({ input }) => {
				const profile = resolveImportProfile(input.sourceId);
				if (!profile) {
					throw new TRPCError({
						code: "NOT_FOUND",
						message: "That browser profile is no longer available.",
					});
				}

				try {
					return await importCookiesIntoSession(
						session.fromPartition(BROWSER_PARTITION),
						profile.profileDir,
						profile.browserKey,
					);
				} catch (error) {
					throw new TRPCError({
						code: "INTERNAL_SERVER_ERROR",
						message:
							error instanceof Error
								? `Could not import browser cookies: ${error.message}`
								: "Could not import browser cookies.",
					});
				}
			}),
	});
};

import type { CookieImportResult } from "./chrome-cookie-import";
import {
	listChromeImportSources,
	resolveImportSource,
	resolveImportProfile,
	type ImportedHistoryEntry,
} from "./chrome-history-import";
import type { ChromiumProfile } from "./chromium-profiles";
export class BrowserImportService {
	constructor(
		private readonly dependencies: {
			profiles(): ChromiumProfile[];
			needsFullDiskAccess(): boolean;
			readHistory(profileDir: string): Promise<ImportedHistoryEntry[]>;
			writeHistory(entries: ImportedHistoryEntry[]): void;
			importCookies(
				profileDir: string,
				browserKey: string,
			): Promise<CookieImportResult>;
			requestFullDiskAccess(): Promise<void>;
		},
	) {}
	getSources() {
		const sources = listChromeImportSources(this.dependencies.profiles());
		return {
			sources,
			needsFullDiskAccess:
				sources.length === 0 && this.dependencies.needsFullDiskAccess(),
		};
	}
	async importHistory(sourceId: string, current: () => boolean) {
		if (!current()) throw Error("Browser import window changed");
		const profileDir = resolveImportSource(
			sourceId,
			this.dependencies.profiles(),
		);
		if (!profileDir)
			throw Error("That browser profile is no longer available.");
		const entries = await this.dependencies.readHistory(profileDir);
		if (!current()) throw Error("Browser import window changed");
		if (entries.length) this.dependencies.writeHistory(entries);
		return { imported: entries.length };
	}
	async importCookies(sourceId: string) {
		const profile = resolveImportProfile(
			sourceId,
			this.dependencies.profiles(),
		);
		if (!profile) throw Error("That browser profile is no longer available.");
		return this.dependencies.importCookies(
			profile.profileDir,
			profile.browserKey,
		);
	}
	requestFullDiskAccess() {
		return this.dependencies.requestFullDiskAccess();
	}
}

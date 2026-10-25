import { expect, test } from "bun:test";
import { BrowserImportService } from "./browser-import-service";
import type { ChromiumProfile } from "./chromium-profiles";
import type { ImportedHistoryEntry } from "./chrome-history-import";
const profile: ChromiumProfile = {
	browser: {
		key: "chrome",
		name: "Google Chrome",
		userDataDir: "/owned/config/google-chrome",
	},
	directoryName: "Default",
	displayName: "Owned 中文",
	profileDir: "/owned/config/google-chrome/Default",
};
function fixture() {
	let profiles = [profile],
		reads = 0,
		writes = 0,
		cookies = 0;
	const deps = {
		profiles: () => profiles,
		needsFullDiskAccess: () => false,
		readHistory: async (_path: string) => {
			reads++;
			return [
				{
					url: "https://owned.test/",
					title: "Owned",
					lastVisitedAt: 1,
					visitCount: 3,
				},
			];
		},
		writeHistory: (_entries: ImportedHistoryEntry[]) => {
			writes++;
		},
		importCookies: async (_path: string, _key: string) => {
			cookies++;
			return { imported: 0, skipped: 0, keyUnavailable: true };
		},
		requestFullDiskAccess: async () => {},
	};
	return {
		deps,
		service: new BrowserImportService(deps),
		remove: () => {
			profiles = [];
		},
		counts: () => ({ reads, writes, cookies }),
	};
}
test("only currently discovered profile identities can read or import history and cookies", async () => {
	const f = fixture();
	expect(f.service.getSources()).toEqual({
		needsFullDiskAccess: false,
		sources: [
			{
				id: profile.profileDir,
				browserKey: "chrome",
				browserName: "Google Chrome",
				profileName: "Owned 中文",
			},
		],
	});
	await expect(
		f.service.importHistory("/arbitrary/path", () => true),
	).rejects.toThrow("no longer available");
	await expect(f.service.importCookies("/arbitrary/path")).rejects.toThrow(
		"no longer available",
	);
	expect(f.counts()).toEqual({ reads: 0, writes: 0, cookies: 0 });
	expect(await f.service.importHistory(profile.profileDir, () => true)).toEqual(
		{ imported: 1 },
	);
	expect(await f.service.importCookies(profile.profileDir)).toEqual({
		imported: 0,
		skipped: 0,
		keyUnavailable: true,
	});
	f.remove();
	await expect(
		f.service.importHistory(profile.profileDir, () => true),
	).rejects.toThrow("no longer available");
	expect(f.counts()).toEqual({ reads: 1, writes: 1, cookies: 1 });
});
test("a window replaced during an asynchronous source read cannot commit into its closed history database", async () => {
	const f = fixture();
	let resolve!: (entries: ImportedHistoryEntry[]) => void,
		current = true;
	f.deps.readHistory = () =>
		new Promise((done) => {
			resolve = done;
		});
	const pending = f.service.importHistory(profile.profileDir, () => current);
	current = false;
	resolve([
		{
			url: "https://owned.test/stale",
			title: "Stale",
			lastVisitedAt: 1,
			visitCount: 1,
		},
	]);
	await expect(pending).rejects.toThrow("window changed");
	expect(f.counts().writes).toBe(0);
});

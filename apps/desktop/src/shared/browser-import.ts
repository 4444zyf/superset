export interface BrowserImportProfile {
	id: string;
	browserKey: string;
	browserName: string;
	profileName: string;
}
export interface BrowserImportCookieResult {
	imported: number;
	skipped: number;
	keyUnavailable: boolean;
}
export interface BrowserImportApi {
	getSources(): Promise<{
		needsFullDiskAccess: boolean;
		sources: BrowserImportProfile[];
	}>;
	importHistory(input: { sourceId: string }): Promise<{ imported: number }>;
	importCookies(input: {
		sourceId: string;
	}): Promise<BrowserImportCookieResult>;
	requestFullDiskAccess(): Promise<void>;
}

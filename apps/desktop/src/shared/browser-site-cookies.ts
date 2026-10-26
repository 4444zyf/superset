export interface BrowserCookieDomain {
	domain: string;
	cookieCount: number;
}
export interface BrowserSiteCookiesApi {
	getDomains(): Promise<BrowserCookieDomain[]>;
	forget(input: { domain: string }): Promise<{ success: boolean }>;
}

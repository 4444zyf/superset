import type { BrowserCdpTokenScope } from "@superset/shared/browser-cdp-token";

export interface HostAuthProvider {
	validate(request: Request): Promise<boolean> | boolean;
	validateToken(token: string): Promise<boolean> | boolean;
	validateBrowserCdpToken?(
		token: string,
		scope: BrowserCdpTokenScope,
	): Promise<boolean> | boolean;
}

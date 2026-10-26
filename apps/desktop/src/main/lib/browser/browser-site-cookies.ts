import type { Cookies } from "electron";
import type { BrowserSiteCookiesApi } from "shared/browser-site-cookies";

export function createBrowserSiteCookies(
	getCookies: () => Pick<Cookies, "get" | "remove">,
): BrowserSiteCookiesApi {
	return {
		getDomains: async () => {
			const cookies = await getCookies().get({});
			const domains = new Map<string, number>();
			for (const cookie of cookies) {
				if (!cookie.domain) continue;
				const domain = cookie.domain.replace(/^\./, "");
				domains.set(domain, (domains.get(domain) ?? 0) + 1);
			}
			return [...domains.entries()]
				.map(([domain, cookieCount]) => ({ domain, cookieCount }))
				.sort((a, b) => a.domain.localeCompare(b.domain));
		},
		forget: async ({ domain }) => {
			const cookieStore = getCookies();
			const cookies = await cookieStore.get({ domain });
			await Promise.all(
				cookies.map((cookie) => {
					const scheme = cookie.secure ? "https" : "http";
					const cookieDomain = (cookie.domain ?? domain).replace(/^\./, "");
					const url = `${scheme}://${cookieDomain}${cookie.path}`;
					return cookieStore.remove(url, cookie.name);
				}),
			);
			return { success: true };
		},
	};
}

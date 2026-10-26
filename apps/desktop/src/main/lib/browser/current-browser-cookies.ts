import type { Cookies } from "electron";

type CookieStore = Pick<Cookies, "get" | "remove">;
export function currentBrowserCookies(
	getCookies: () => CookieStore,
	isCurrent: () => boolean,
): () => CookieStore {
	const assertCurrent = () => {
		if (!isCurrent()) throw new Error("Browser window is no longer current");
	};
	return () => {
		const cookies = getCookies();
		return {
			get: async (filter) => {
				assertCurrent();
				const result = await cookies.get(filter);
				assertCurrent();
				return result;
			},
			remove: async (url, name) => {
				assertCurrent();
				await cookies.remove(url, name);
			},
		};
	};
}

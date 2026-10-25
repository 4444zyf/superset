import { expect, test } from "bun:test";
import { clearBrowserSessionData } from "./clear-browser-session-data";

test("clearing cached files preserves login and local storage, and clearing cookies preserves other site data", async () => {
	const state = {
		cookies: ["signed-in"],
		cache: ["cached response"],
		localStorage: "draft",
	};
	const session = {
		clearStorageData: async (options?: { storages?: string[] }) => {
			if (!options?.storages || options.storages.includes("cookies"))
				state.cookies = [];
			if (!options?.storages || options.storages.includes("localstorage"))
				state.localStorage = "";
		},
		clearCache: async () => {
			state.cache = [];
		},
	};
	await clearBrowserSessionData(session, { type: "cache" });
	expect(state).toEqual({
		cookies: ["signed-in"],
		cache: [],
		localStorage: "draft",
	});
	await clearBrowserSessionData(session, { type: "cookies" });
	expect(state).toEqual({ cookies: [], cache: [], localStorage: "draft" });
});
test("a storage failure propagates without clearing cache or reporting success", async () => {
	const failure = Error("Owned storage clear denied");
	let cacheCleared = false;
	const session = {
		clearStorageData: async () => {
			throw failure;
		},
		clearCache: async () => {
			cacheCleared = true;
		},
	};
	await expect(clearBrowserSessionData(session, { type: "all" })).rejects.toBe(
		failure,
	);
	expect(cacheCleared).toBe(false);
});

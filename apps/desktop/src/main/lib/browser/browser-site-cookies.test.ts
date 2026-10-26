import { expect, test } from "bun:test";
import type { Cookie, CookiesGetFilter } from "electron";
import { createBrowserSiteCookies } from "./browser-site-cookies";

const cookie = (patch: Partial<Cookie>): Cookie => ({
	name: "owned",
	value: "fixture",
	path: "/",
	secure: false,
	httpOnly: false,
	session: true,
	sameSite: "unspecified",
	...patch,
});
test("cookie domains retain the original aggregation, leading-dot handling and alphabetical order", async () => {
	let reads = 0;
	const api = createBrowserSiteCookies(() => ({
		get: async (filter) => {
			expect(filter).toEqual({});
			reads++;
			return [
				cookie({ domain: ".z.test" }),
				cookie({ domain: "a.test" }),
				cookie({ domain: "z.test" }),
				cookie({ domain: "" }),
				cookie({ domain: undefined }),
			];
		},
		remove: async () => {
			throw Error("Read must not remove cookies");
		},
	}));
	expect(reads).toBe(0);
	expect(await api.getDomains()).toEqual([
		{ domain: "a.test", cookieCount: 1 },
		{ domain: "z.test", cookieCount: 2 },
	]);
	expect(reads).toBe(1);
});
test("forget uses the original domain filter and preserves secure scheme, path and cookie name", async () => {
	const filters: CookiesGetFilter[] = [],
		removed: unknown[] = [];
	const api = createBrowserSiteCookies(() => ({
		get: async (filter) => {
			filters.push(filter);
			return [
				cookie({
					domain: ".owned.test",
					name: "secure",
					secure: true,
					path: "/account",
				}),
				cookie({ domain: "owned.test", name: "plain", path: "/nested/" }),
			];
		},
		remove: async (url, name) => {
			removed.push({ url, name });
		},
	}));
	expect(await api.forget({ domain: "owned.test" })).toEqual({ success: true });
	expect(filters).toEqual([{ domain: "owned.test" }]);
	expect(removed).toEqual([
		{ url: "https://owned.test/account", name: "secure" },
		{ url: "http://owned.test/nested/", name: "plain" },
	]);
});
test("forget retains the original requested-domain fallback for a cookie without a domain", async () => {
	const removed: string[] = [];
	const api = createBrowserSiteCookies(() => ({
		get: async () => [cookie({ domain: undefined })],
		remove: async (url) => {
			removed.push(url);
		},
	}));
	await api.forget({ domain: "owned.test" });
	expect(removed).toEqual(["http://owned.test/"]);
});
test("cookie read and remove failures propagate instead of reporting a successful forget", async () => {
	const failure = Error("Owned cookie store unavailable");
	const unreadable = createBrowserSiteCookies(() => ({
		get: async () => {
			throw failure;
		},
		remove: async () => {},
	}));
	await expect(unreadable.getDomains()).rejects.toBe(failure);
	await expect(unreadable.forget({ domain: "owned.test" })).rejects.toBe(
		failure,
	);
	const failingRemove = createBrowserSiteCookies(() => ({
		get: async () => [cookie({ domain: "owned.test" })],
		remove: async () => {
			throw failure;
		},
	}));
	await expect(failingRemove.forget({ domain: "owned.test" })).rejects.toBe(
		failure,
	);
});

test("constructing the service does not acquire Electron's cookie session before it is needed", async () => {
	let acquired = 0;
	const api = createBrowserSiteCookies(() => {
		acquired++;
		return { get: async () => [], remove: async () => {} };
	});
	expect(acquired).toBe(0);
	await api.getDomains();
	expect(acquired).toBe(1);
});

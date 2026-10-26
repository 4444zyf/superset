import { expect, test } from "bun:test";
import type { Cookie } from "electron";
import { createBrowserSiteCookies } from "./browser-site-cookies";
import { currentBrowserCookies } from "./current-browser-cookies";

test("a window replaced during cookie lookup cannot clear the returned cookies", async () => {
	let finish!: (cookies: Cookie[]) => void,
		current = true,
		removals = 0;
	const api = createBrowserSiteCookies(
		currentBrowserCookies(
			() => ({
				get: () =>
					new Promise<Cookie[]>((resolve) => {
						finish = resolve;
					}),
				remove: async () => {
					removals++;
				},
			}),
			() => current,
		),
	);
	const pending = api.forget({ domain: "owned.test" });
	current = false;
	finish([]);
	await expect(pending).rejects.toThrow("no longer current");
	expect(removals).toBe(0);
});
test("the cookie store rejects further removal when its owning window is no longer current", async () => {
	let current = true,
		removals = 0;
	const store = currentBrowserCookies(
		() => ({
			get: async () => [],
			remove: async () => {
				removals++;
			},
		}),
		() => current,
	)();
	await store.remove("http://owned.test/", "owned");
	current = false;
	await expect(store.remove("http://owned.test/", "owned")).rejects.toThrow(
		"no longer current",
	);
	expect(removals).toBe(1);
});

import { afterEach, expect, spyOn, test } from "bun:test";
import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
} from "@testing-library/react";
import { toast } from "@superset/ui/sonner";
import {
	ClearBrowsingDataDialogView,
	type ClearBrowsingDataSource,
} from "./ClearBrowsingDataDialogView";
afterEach(cleanup);
test("a history failure still clears the other selected categories and reports the exact partial result", async () => {
	const calls: string[] = [],
		messages: string[] = [],
		closed: boolean[] = [];
	const notification = spyOn(toast, "error").mockImplementation((message) => {
		messages.push(String(message));
		return "owned-toast";
	});
	try {
		const source: ClearBrowsingDataSource = {
			clearHistory: async () => {
				calls.push("history");
				throw Error("Owned history failure");
			},
			clearCookies: async () => {
				calls.push("cookies");
			},
			clearCache: async () => {
				calls.push("cache");
			},
		};
		render(
			<ClearBrowsingDataDialogView
				open
				source={source}
				onOpenChange={(open) => closed.push(open)}
			/>,
		);
		await act(async () =>
			fireEvent.click(screen.getByRole("button", { name: "Clear data" })),
		);
		expect(calls).toEqual(["history", "cookies", "cache"]);
		expect(messages).toEqual([
			"Cleared cookies and site data, cached files — could not clear history",
		]);
		expect(closed).toEqual([]);
		expect(
			screen
				.getByRole("button", { name: "Clear data" })
				.hasAttribute("disabled"),
		).toBe(false);
	} finally {
		notification.mockRestore();
	}
});
test("only selected cache is cleared, and choosing nothing disables the destructive action", async () => {
	const calls: string[] = [],
		closed: boolean[] = [];
	const notification = spyOn(toast, "success").mockImplementation(
		() => "owned-toast",
	);
	try {
		const source: ClearBrowsingDataSource = {
			clearHistory: async () => {
				calls.push("history");
			},
			clearCookies: async () => {
				calls.push("cookies");
			},
			clearCache: async () => {
				calls.push("cache");
			},
		};
		render(
			<ClearBrowsingDataDialogView
				open
				source={source}
				onOpenChange={(open) => closed.push(open)}
			/>,
		);
		for (const label of [
			"Browsing history",
			"Cookies and site data — signs you out of most sites",
			"Cached images and files",
		])
			fireEvent.click(screen.getByRole("checkbox", { name: label }));
		expect(
			screen
				.getByRole("button", { name: "Clear data" })
				.hasAttribute("disabled"),
		).toBe(true);
		fireEvent.click(
			screen.getByRole("checkbox", { name: "Cached images and files" }),
		);
		await act(async () =>
			fireEvent.click(screen.getByRole("button", { name: "Clear data" })),
		);
		expect(calls).toEqual(["cache"]);
		expect(closed).toEqual([false]);
	} finally {
		notification.mockRestore();
	}
});

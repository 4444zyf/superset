import { afterEach, expect, jest, test } from "bun:test";
import { TooltipProvider } from "@superset/ui/tooltip";
import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
} from "@testing-library/react";
import type { ComponentProps } from "react";
import { workstationBrowsers } from "../../../../providers/WorkstationBrowsers/workstation-browsers";
import { WorkspaceBrowserPane } from "./WorkspaceBrowserPane";
afterEach(() => {
	cleanup();
	jest.useRealTimers();
});
test("history selection removes its dialog when another browser dialog is available and the pane rerenders", async () => {
	jest.useFakeTimers();
	const profile = {
			id: "/owned/profile",
			browserKey: "chrome",
			browserName: "Chrome",
			profileName: "Owned",
		},
		row = {
			id: "owned",
			url: "https://owned.test/",
			title: "Owned visit",
			faviconUrl: null,
			lastVisitedAt: 1,
			visitCount: 1,
		};
	const props = {
		api: {
			browser: {
				register: async () => {},
				unregister: async () => {},
				onEvent: () => () => {},
				navigate: async ({ url }: { url: string }) => ({
					status: "navigated",
					url,
					guestUrl: url,
				}),
				history: {
					getAll: async () => [row],
					search: async () => [row],
					upsert: async () => {},
					clear: async () => {},
				},
				importData: {
					getSources: async () => ({
						sources: [profile],
						needsFullDiskAccess: false,
					}),
					importHistory: async () => ({ imported: 0 }),
					importCookies: async () => ({
						imported: 0,
						skipped: 0,
						keyUnavailable: true,
					}),
					requestFullDiskAccess: async () => {},
				},
			},
		},
		connection: {
			connectionId: crypto.randomUUID(),
			generation: 1,
			backendId: "owned",
			namespaceId: "owned",
			instanceId: "owned",
		},
		workspaceId: crypto.randomUUID(),
		pane: {
			kind: "browser",
			paneId: "owned-browser",
			resourceId: crypto.randomUUID(),
			browser: { url: "about:blank", pageTitle: "", faviconUrl: null },
		},
		actions: {
			persistBrowserPage: () => {},
			closeBrowserPane: async () => {},
			newBrowser: async () => {},
		},
		onFocus: () => {},
	} as unknown as ComponentProps<typeof WorkspaceBrowserPane>;
	const runtime = workstationBrowsers(props.api);
	try {
		render(
			<TooltipProvider>
				<WorkspaceBrowserPane {...props} />
			</TooltipProvider>,
		);
		const guest = document.querySelector("webview");
		if (!guest) throw Error("Guest element missing");
		Object.assign(guest, {
			getWebContentsId: () => 1,
			executeJavaScript: async () => null,
		});
		await act(async () => guest.dispatchEvent(new Event("dom-ready")));
		fireEvent.pointerDown(
			screen.getByRole("button", { name: "More options" }),
			{ button: 0, ctrlKey: false },
		);
		fireEvent.click(screen.getByRole("menuitem", { name: "History" }));
		await act(async () => jest.advanceTimersByTime(200));
		const button = screen.queryAllByText("Owned visit")[0]?.closest("button");
		if (!button) throw Error("History row missing");
		await act(async () => fireEvent.click(button));
		expect(Boolean(screen.queryByRole("dialog"))).toBe(false);
	} finally {
		cleanup();
		runtime.reconcile(null);
	}
});

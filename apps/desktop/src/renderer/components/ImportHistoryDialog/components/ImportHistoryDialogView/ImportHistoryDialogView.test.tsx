import { afterEach, expect, test } from "bun:test";
import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
} from "@testing-library/react";
import {
	ImportHistoryDialogView,
	type BrowserImportDataSource,
} from "./ImportHistoryDialogView";
import type { BrowserImportProfile } from "shared/browser-import";
afterEach(cleanup);
const profile: BrowserImportProfile = {
	id: "/owned/profile",
	browserKey: "chrome",
	browserName: "Owned Chrome",
	profileName: "中文",
};
const listing = { sources: [profile], needsFullDiskAccess: false };
function source(): BrowserImportDataSource {
	return {
		getSources: async () => listing,
		importHistory: async () => ({ imported: 2 }),
		importCookies: async () => ({
			imported: 0,
			skipped: 0,
			keyUnavailable: true,
		}),
		requestFullDiskAccess: async () => {},
	};
}
test("reopened import discovery ignores the older result instead of replacing its selected profile", async () => {
	const requests: Array<(value: typeof listing) => void> = [],
		api = {
			...source(),
			getSources: () =>
				new Promise<typeof listing>((resolve) => requests.push(resolve)),
		};
	const view = render(
		<ImportHistoryDialogView
			open
			source={api}
			onOpenChange={() => {}}
			canImportLogins={false}
		/>,
	);
	view.rerender(
		<ImportHistoryDialogView
			open={false}
			source={api}
			onOpenChange={() => {}}
			canImportLogins={false}
		/>,
	);
	view.rerender(
		<ImportHistoryDialogView
			open
			source={api}
			onOpenChange={() => {}}
			canImportLogins={false}
		/>,
	);
	await act(async () => {
		requests[1]?.(listing);
	});
	expect(Boolean(screen.queryByText("Owned Chrome"))).toBe(true);
	await act(async () => {
		requests[0]?.({
			sources: [{ ...profile, browserName: "Old browser", id: "/owned/old" }],
			needsFullDiskAccess: false,
		});
	});
	expect(Boolean(screen.queryByText("Old browser"))).toBe(false);
	expect(Boolean(screen.queryByText("Owned Chrome"))).toBe(true);
});
test("a failed source read is visible rather than claiming no browsers are installed", async () => {
	const api = {
		...source(),
		getSources: async () => {
			throw Error("Source unavailable");
		},
	};
	render(
		<ImportHistoryDialogView
			open
			source={api}
			onOpenChange={() => {}}
			canImportLogins={false}
		/>,
	);
	await act(async () => {});
	expect(screen.getByRole("alert").textContent).toBe("An error occurred");
	expect(
		Boolean(
			screen.queryByText(
				"No Chrome, Brave, Arc, or other Chromium browsers were found.",
			),
		),
	).toBe(false);
});
test("an in-flight import blocks dialog close, and a replaced dialog ignores its old completion", async () => {
	let resolve!: (value: { imported: number }) => void;
	const closes: boolean[] = [],
		api = {
			...source(),
			importHistory: () =>
				new Promise<{ imported: number }>((done) => {
					resolve = done;
				}),
		};
	const view = render(
		<ImportHistoryDialogView
			open
			source={api}
			onOpenChange={(open) => closes.push(open)}
			canImportLogins={false}
		/>,
	);
	await act(async () => {});
	await act(async () =>
		fireEvent.click(screen.getByRole("button", { name: "Import" })),
	);
	fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
	fireEvent.click(screen.getByRole("button", { name: "Close" }));
	expect(closes).toEqual([]);
	view.rerender(
		<ImportHistoryDialogView
			open={false}
			source={api}
			onOpenChange={(open) => closes.push(open)}
			canImportLogins={false}
		/>,
	);
	view.rerender(
		<ImportHistoryDialogView
			open
			source={api}
			onOpenChange={(open) => closes.push(open)}
			canImportLogins={false}
		/>,
	);
	await act(async () => {});
	expect(
		(
			screen.getByRole("button", {
				name: "Import",
			}) as HTMLButtonElement
		).disabled,
	).toBe(false);
	await act(async () => resolve({ imported: 2 }));
	expect(closes).toEqual([]);
	expect(Boolean(screen.queryByRole("dialog"))).toBe(true);
});
test("successful history before a failed cookie import still notifies the banner owner and leaves retry available", async () => {
	let imported = 0,
		closed = 0;
	const api = {
		...source(),
		importCookies: async () => {
			throw Error("Keychain locked");
		},
		onImported: () => {
			imported++;
		},
	};
	render(
		<ImportHistoryDialogView
			open
			source={api}
			onOpenChange={() => {
				closed++;
			}}
			canImportLogins
		/>,
	);
	await act(async () => {});
	await act(async () =>
		fireEvent.click(screen.getByRole("button", { name: "Import" })),
	);
	expect(imported).toBe(1);
	expect(closed).toBe(0);
	expect(
		(
			screen.getByRole("button", {
				name: "Import",
			}) as HTMLButtonElement
		).disabled,
	).toBe(false);
});

import { afterEach, expect, test } from "bun:test";
import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
} from "@testing-library/react";
import {
	HistoryDialogView,
	type BrowserHistorySource,
	type HistoryEntry,
} from "./HistoryDialogView";
afterEach(cleanup);
const row: HistoryEntry = {
	id: "visit",
	url: "https://example.test/visited",
	title: "Visited page",
	faviconUrl: null,
	lastVisitedAt: 1,
};
const props = { onOpenChange: () => {}, onSelect: () => {} };
test("closing and reopening ignores an older recent-history response", async () => {
	const old = Promise.withResolvers<HistoryEntry[]>(),
		current = Promise.withResolvers<HistoryEntry[]>();
	let reads = 0;
	const source: BrowserHistorySource = {
		getAll: () => (++reads === 1 ? old.promise : current.promise),
		search: async () => [],
		clear: async () => {},
	};
	const view = render(<HistoryDialogView {...props} open source={source} />);
	view.rerender(<HistoryDialogView {...props} open={false} source={source} />);
	view.rerender(<HistoryDialogView {...props} open source={source} />);
	await act(async () => current.resolve([]));
	await act(async () => old.resolve([row]));
	expect(Boolean(screen.queryByText("Visited page"))).toBe(false);
	expect(screen.getByText("No history yet")).toBeTruthy();
});
test("clearing during a reopen cannot resurrect rows from the pending recent-history read", async () => {
	const pending = Promise.withResolvers<HistoryEntry[]>();
	let reads = 0,
		clears = 0;
	const source: BrowserHistorySource = {
		getAll: () => (++reads === 1 ? Promise.resolve([row]) : pending.promise),
		search: async () => [],
		clear: async () => {
			clears++;
		},
	};
	const view = render(<HistoryDialogView {...props} open source={source} />);
	await act(async () => {});
	expect(screen.getByText("Visited page")).toBeTruthy();
	view.rerender(<HistoryDialogView {...props} open={false} source={source} />);
	view.rerender(<HistoryDialogView {...props} open source={source} />);
	await act(async () =>
		fireEvent.click(screen.getByRole("button", { name: "Clear history" })),
	);
	expect(clears).toBe(1);
	await act(async () => pending.resolve([row]));
	expect(Boolean(screen.queryByText("Visited page"))).toBe(false);
	expect(screen.getByText("No history yet")).toBeTruthy();
});

test("a failed clear retains records and reports the failure", async () => {
	const source: BrowserHistorySource = {
		getAll: async () => [row],
		search: async () => [],
		clear: async () => {
			throw Error("Owned clear failed");
		},
	};
	render(<HistoryDialogView {...props} open source={source} />);
	await act(async () => {});
	await act(async () =>
		fireEvent.click(screen.getByRole("button", { name: "Clear history" })),
	);
	expect(Boolean(screen.queryByText("Visited page"))).toBe(true);
	expect(screen.getByRole("alert").textContent).toBe("An error occurred");
});

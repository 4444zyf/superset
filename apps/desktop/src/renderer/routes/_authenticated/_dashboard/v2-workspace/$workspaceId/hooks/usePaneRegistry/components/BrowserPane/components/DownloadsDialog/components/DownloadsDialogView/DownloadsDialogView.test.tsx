import { afterEach, expect, test } from "bun:test";
import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
} from "@testing-library/react";
import {
	DownloadsDialogView,
	type DownloadsSource,
	type DownloadRow,
} from "./DownloadsDialogView";
afterEach(cleanup);
const row: DownloadRow = {
	id: "owned",
	filename: "file.txt",
	state: "completed",
	receivedBytes: 4,
	totalBytes: 4,
};
function operations() {
	return {
		cancel: async () => ({ cancelled: false }),
		open: async () => ({ success: true }),
		showInFolder: async () => ({ success: true }),
		clear: async () => ({ success: true }),
	};
}
test("a failed initial read is visible and old subscription callbacks cannot replace a reopened list", async () => {
	const callbacks: Array<(rows: DownloadRow[]) => void> = [];
	let subscriptions = 0,
		stopped = 0;
	const source: DownloadsSource = {
		...operations(),
		subscribe(onData, onError) {
			callbacks.push(onData);
			if (++subscriptions === 1) onError();
			else onData([row]);
			return () => {
				stopped++;
			};
		},
	};
	const view = render(
		<DownloadsDialogView open source={source} onOpenChange={() => {}} />,
	);
	expect(screen.getByRole("alert").textContent).toBe("An error occurred");
	expect(Boolean(screen.queryByText("No downloads yet"))).toBe(false);
	view.rerender(
		<DownloadsDialogView
			open={false}
			source={source}
			onOpenChange={() => {}}
		/>,
	);
	view.rerender(
		<DownloadsDialogView open source={source} onOpenChange={() => {}} />,
	);
	await act(async () => callbacks[0]?.([]));
	expect(Boolean(screen.queryByText("file.txt"))).toBe(true);
	expect(Boolean(screen.queryByRole("alert"))).toBe(false);
	expect(stopped).toBe(1);
});
test("an unsuccessful shell-open result is reported while the completed download stays in the list", async () => {
	const source: DownloadsSource = {
		...operations(),
		subscribe(onData) {
			onData([row]);
			return () => {};
		},
		open: async () => ({ success: false }),
	};
	render(<DownloadsDialogView open source={source} onOpenChange={() => {}} />);
	const button = screen.getByText("file.txt").closest("button");
	if (!button) throw Error("Completed file button missing");
	await act(async () => fireEvent.click(button));
	expect(screen.getByRole("alert").textContent).toBe("An error occurred");
	expect(Boolean(screen.queryByText("file.txt"))).toBe(true);
});

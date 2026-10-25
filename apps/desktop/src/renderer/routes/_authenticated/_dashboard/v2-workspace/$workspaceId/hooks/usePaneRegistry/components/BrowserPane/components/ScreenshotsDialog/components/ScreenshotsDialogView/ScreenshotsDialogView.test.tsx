import { afterEach, expect, test } from "bun:test";
import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
} from "@testing-library/react";
import {
	ScreenshotsDialogView,
	type ScreenshotsSource,
	type ScreenshotRow,
} from "./ScreenshotsDialogView";
afterEach(cleanup);
const row: ScreenshotRow = {
	id: "owned",
	filename: "file.png",
	savePath: "/owned/file.png",
	width: 40,
	height: 20,
	thumbnail: "data:image/png;base64,owned",
	capturedAt: 1,
};
function operations() {
	return {
		open: async () => ({ success: true }),
		showInFolder: async () => ({ success: true }),
		clear: async () => ({ success: true }),
		copyPath: async () => {},
	};
}
test("a failed initial read is visible and old subscription callbacks cannot replace a reopened list", async () => {
	const callbacks: Array<(rows: ScreenshotRow[]) => void> = [];
	let subscriptions = 0,
		stopped = 0;
	const source: ScreenshotsSource = {
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
		<ScreenshotsDialogView open source={source} onOpenChange={() => {}} />,
	);
	expect(screen.getByRole("alert").textContent).toBe("An error occurred");
	expect(Boolean(screen.queryByText("No screenshots yet"))).toBe(false);
	view.rerender(
		<ScreenshotsDialogView
			open={false}
			source={source}
			onOpenChange={() => {}}
		/>,
	);
	view.rerender(
		<ScreenshotsDialogView open source={source} onOpenChange={() => {}} />,
	);
	await act(async () => callbacks[0]?.([]));
	expect(Boolean(screen.queryByText("file.png"))).toBe(true);
	expect(Boolean(screen.queryByRole("alert"))).toBe(false);
	expect(stopped).toBe(1);
});
test("an unsuccessful shell-open result is reported while the screenshot stays in the list", async () => {
	const source: ScreenshotsSource = {
		...operations(),
		subscribe(onData) {
			onData([row]);
			return () => {};
		},
		open: async () => ({ success: false }),
	};
	render(
		<ScreenshotsDialogView open source={source} onOpenChange={() => {}} />,
	);
	const button = screen.getByText("file.png").closest("button");
	if (!button) throw Error("Completed file button missing");
	await act(async () => fireEvent.click(button));
	expect(screen.getByRole("alert").textContent).toBe("An error occurred");
	expect(Boolean(screen.queryByText("file.png"))).toBe(true);
});

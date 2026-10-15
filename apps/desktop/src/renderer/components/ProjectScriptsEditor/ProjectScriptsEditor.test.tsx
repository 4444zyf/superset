import { afterEach, expect, test } from "bun:test";
import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { ProjectScriptsEditor } from "./ProjectScriptsEditor";
afterEach(cleanup);

test("original script debounce queues a revert made during a pending save", async () => {
	const writes: unknown[] = [];
	let finish!: () => void;
	render(
		<ProjectScriptsEditor
			content={JSON.stringify({ setup: ["original"] })}
			debounceMs={1}
			onSave={async (next) => {
				writes.push(next);
				if (writes.length === 1)
					await new Promise<void>((resolve) => {
						finish = resolve;
					});
			}}
		/>,
	);
	const input = screen.getByRole("textbox");
	fireEvent.change(input, { target: { value: "first" } });
	await waitFor(() => expect(writes).toHaveLength(1));
	fireEvent.change(input, { target: { value: "original" } });
	fireEvent.blur(input);
	await act(async () => finish());
	await waitFor(() => expect(writes).toHaveLength(2));
	expect(writes[1]).toEqual({ setup: ["original"], teardown: [], run: [] });
	await screen.findByText("Saved");
});

test("unknown script save results keep the latest draft and stop queued or blur replay", async () => {
	let writes = 0;
	let reject!: (e: Error) => void;
	render(
		<ProjectScriptsEditor
			content={null}
			debounceMs={1}
			pauseOnError
			onSave={async () => {
				writes++;
				await new Promise<void>((_, r) => {
					reject = r;
				});
			}}
		/>,
	);
	const input = screen.getByRole("textbox") as HTMLTextAreaElement;
	fireEvent.change(input, { target: { value: "first" } });
	await waitFor(() => expect(writes).toBe(1));
	fireEvent.change(input, { target: { value: "draft" } });
	fireEvent.blur(input);
	await act(async () => reject(new Error("Reply unavailable")));
	await screen.findByText("Couldn't save");
	fireEvent.blur(input);
	expect(writes).toBe(1);
	expect(input.value).toBe("draft");
});

test("closing a script editor drops its pending queue and ignores a late confirmation", async () => {
	let writes = 0;
	let finish!: () => void;
	const view = render(
		<ProjectScriptsEditor
			content={null}
			debounceMs={1}
			onSave={async () => {
				writes++;
				await new Promise<void>((resolve) => {
					finish = resolve;
				});
			}}
		/>,
	);
	const input = screen.getByRole("textbox");
	fireEvent.change(input, { target: { value: "first" } });
	await waitFor(() => expect(writes).toBe(1));
	fireEvent.change(input, { target: { value: "queued" } });
	fireEvent.blur(input);
	view.unmount();
	await act(async () => finish());
	expect(writes).toBe(1);
});

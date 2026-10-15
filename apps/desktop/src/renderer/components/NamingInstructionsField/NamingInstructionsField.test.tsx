import { afterEach, expect, test } from "bun:test";
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { NamingInstructionsField } from "./NamingInstructionsField";

afterEach(cleanup);

test("the original naming editor debounces text and shows confirmed saved state", async () => {
	const writes: string[] = [];
	render(
		<NamingInstructionsField
			instructions={null}
			debounceMs={1}
			onSave={async (value) => {
				writes.push(value);
			}}
		/>,
	);
	fireEvent.change(screen.getByRole("textbox"), {
		target: { value: "Use ticket ids" },
	});
	await screen.findByText("Saved");
	expect(writes).toEqual(["Use ticket ids"]);
});

test("typing during a naming save retains and drains only the latest confirmed intent", async () => {
	const writes: string[] = [];
	let finish!: () => void;
	render(
		<NamingInstructionsField
			instructions={null}
			debounceMs={1}
			onSave={async (value) => {
				writes.push(value);
				if (writes.length === 1)
					await new Promise<void>((resolve) => {
						finish = resolve;
					});
			}}
		/>,
	);
	const input = screen.getByRole("textbox");
	fireEvent.change(input, { target: { value: "First" } });
	fireEvent.blur(input);
	await waitFor(() => expect(writes).toHaveLength(1));
	fireEvent.change(input, { target: { value: "Second" } });
	fireEvent.blur(input);
	finish();
	await waitFor(() => expect(writes).toEqual(["First", "Second"]));
});

test("an uncertain naming save pauses without sending the queued or blurred draft again", async () => {
	const writes: string[] = [];
	let fail!: (error: Error) => void;
	render(
		<NamingInstructionsField
			instructions={null}
			debounceMs={1}
			pauseOnError
			onSave={async (value) => {
				writes.push(value);
				await new Promise<void>((_, reject) => {
					fail = reject;
				});
			}}
		/>,
	);
	const input = screen.getByRole("textbox") as HTMLTextAreaElement;
	fireEvent.change(input, { target: { value: "First" } });
	fireEvent.blur(input);
	await waitFor(() => expect(writes).toHaveLength(1));
	fireEvent.change(input, { target: { value: "Keep second draft" } });
	fireEvent.blur(input);
	fail(new Error("Reply lost"));
	await screen.findByText("Couldn't save");
	fireEvent.blur(input);
	expect(writes).toEqual(["First"]);
	expect(input.value).toBe("Keep second draft");
});

test("unmounting a naming editor discards its pending queue and late status callback", async () => {
	const writes: string[] = [];
	let finish!: () => void;
	let changed = 0;
	const view = render(
		<NamingInstructionsField
			instructions={null}
			debounceMs={1}
			onChanged={() => {
				changed++;
			}}
			onSave={async (value) => {
				writes.push(value);
				await new Promise<void>((resolve) => {
					finish = resolve;
				});
			}}
		/>,
	);
	const input = screen.getByRole("textbox");
	fireEvent.change(input, { target: { value: "First" } });
	fireEvent.blur(input);
	fireEvent.change(input, { target: { value: "Queued" } });
	fireEvent.blur(input);
	view.unmount();
	finish();
	await Promise.resolve();
	await Promise.resolve();
	expect(writes).toEqual(["First"]);
	expect(changed).toBe(0);
});

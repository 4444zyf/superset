import { afterEach, expect, test } from "bun:test";
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { SparseCheckoutField } from "./SparseCheckoutField";

afterEach(cleanup);

test("sparse folders retain original debounce and do not automatically retry an uncertain write", async () => {
	const writes: string[][] = [];
	render(
		<SparseCheckoutField
			paths={[]}
			debounceMs={1}
			pauseOnError
			onSave={async (paths) => {
				writes.push(paths);
				throw new Error("Reply lost");
			}}
		/>,
	);
	const input = screen.getByRole("textbox") as HTMLTextAreaElement;
	fireEvent.change(input, { target: { value: "packages/ui\napps/desktop" } });
	await screen.findByText("Couldn't save");
	fireEvent.blur(input);
	expect(writes).toEqual([["packages/ui", "apps/desktop"]]);
	expect(input.value).toBe("packages/ui\napps/desktop");
});

test("reverting a sparse list during a pending save is not lost", async () => {
	const writes: string[][] = [];
	let finish!: () => void;
	render(
		<SparseCheckoutField
			paths={["original"]}
			debounceMs={1}
			onSave={async (paths) => {
				writes.push(paths);
				if (writes.length === 1)
					await new Promise<void>((resolve) => {
						finish = resolve;
					});
			}}
		/>,
	);
	const input = screen.getByRole("textbox");
	fireEvent.change(input, { target: { value: "changed" } });
	fireEvent.blur(input);
	fireEvent.change(input, { target: { value: "original" } });
	fireEvent.blur(input);
	finish();
	await waitFor(() => expect(writes).toEqual([["changed"], ["original"]]));
});

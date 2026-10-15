import { afterEach, expect, test } from "bun:test";
import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { ProjectIconPicker } from "./ProjectIconPicker";

afterEach(cleanup);
const base = {
	projectName: "Example",
	iconUrl: "data:image/png;base64,AA==",
	hasCustomIcon: true,
	isIconRemoved: false,
	color: null,
};

test("the original icon picker serializes removal and reset through the supplied data source", async () => {
	const writes: (string | null)[] = [];
	let finish!: () => void;
	render(
		<ProjectIconPicker
			{...base}
			onSetIcon={async (value) => {
				writes.push(value);
				await new Promise<void>((resolve) => {
					finish = resolve;
				});
				return true;
			}}
			onSetColor={async () => true}
		/>,
	);
	fireEvent.click(
		screen.getByRole("button", { name: "Change project icon and color" }),
	);
	fireEvent.click(await screen.findByRole("button", { name: "Remove icon" }));
	const reset = screen.getByRole("button", {
		name: "Reset to default",
	}) as HTMLButtonElement;
	expect(reset.disabled).toBe(true);
	fireEvent.click(reset);
	expect(writes).toEqual(["none"]);
	await act(async () => finish());
	await waitFor(() => expect(reset.disabled).toBe(false));
	fireEvent.click(reset);
	expect(writes).toEqual(["none", null]);
	await act(async () => finish());
});

test("an unavailable data source disables the original picker", () => {
	render(
		<ProjectIconPicker
			{...base}
			disabled
			onSetIcon={async () => true}
			onSetColor={async () => true}
		/>,
	);
	expect(
		(
			screen.getByRole("button", {
				name: "Change project icon and color",
			}) as HTMLButtonElement
		).disabled,
	).toBe(true);
});

test("a glyph decoded after its picker unmounts cannot write to the old project", async () => {
	const { spyOn } = await import("bun:test");
	const image = document.createElement("img");
	const imageDescriptor = Object.getOwnPropertyDescriptor(globalThis, "Image");
	Object.defineProperty(globalThis, "Image", {
		configurable: true,
		value: function DeferredImage() {
			return image;
		},
	});
	const contextSpy = spyOn(
		HTMLCanvasElement.prototype,
		"getContext",
	).mockReturnValue({ drawImage() {} } as unknown as CanvasRenderingContext2D);
	const dataSpy = spyOn(
		HTMLCanvasElement.prototype,
		"toDataURL",
	).mockReturnValue("data:image/png;base64,AA==");
	let writes = 0;
	try {
		const view = render(
			<ProjectIconPicker
				{...base}
				onSetIcon={async () => {
					writes++;
					return true;
				}}
				onSetColor={async () => true}
			/>,
		);
		fireEvent.click(
			screen.getByRole("button", { name: "Change project icon and color" }),
		);
		fireEvent.click(screen.getByTitle("Rocket"));
		expect(image.src).toStartWith("data:image/svg+xml");
		view.unmount();
		await act(async () => {
			image.dispatchEvent(new Event("load"));
		});
		expect(writes).toBe(0);
	} finally {
		if (imageDescriptor)
			Object.defineProperty(globalThis, "Image", imageDescriptor);
		contextSpy.mockRestore();
		dataSpy.mockRestore();
	}
});

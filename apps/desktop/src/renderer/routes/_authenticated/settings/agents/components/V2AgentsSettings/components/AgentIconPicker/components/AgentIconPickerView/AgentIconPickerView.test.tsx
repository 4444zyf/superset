import { afterEach, expect, test } from "bun:test";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { AgentIconPickerView } from "./AgentIconPickerView";

afterEach(cleanup);
test("an open original icon menu cannot change a selection after it becomes disabled", async () => {
	const changed: (string | null)[] = [];
	const props = {
		value: null,
		onChange: (v: string | null) => changed.push(v),
		renderIcon: () => null,
		selectImage: async () => ({ canceled: true }),
	};
	const view = render(<AgentIconPickerView {...props} />);
	fireEvent.pointerDown(screen.getByRole("button", { name: "No icon" }), {
		button: 0,
		ctrlKey: false,
	});
	const item = await screen.findByRole("menuitem", { name: "Gemini" });
	view.rerender(<AgentIconPickerView {...props} disabled />);
	fireEvent.click(item);
	expect(changed).toEqual([]);
});

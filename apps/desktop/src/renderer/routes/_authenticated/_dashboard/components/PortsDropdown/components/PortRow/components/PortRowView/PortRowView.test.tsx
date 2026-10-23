import { afterEach, expect, test } from "bun:test";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { PortRowView } from "./PortRowView";

afterEach(cleanup);
test("the original port actions remain independently wired", () => {
	const actions: string[] = [];
	const props = {
		port: { port: 3000 },
		description: "Web",
		address: "localhost:3000",
		onPrimary: () => {
			actions.push("primary");
		},
		onExternal: () => {
			actions.push("external");
		},
		onCopy: async () => {
			actions.push("copy");
		},
		onClose: () => {
			actions.push("close");
		},
	};
	const view = render(<PortRowView {...props} />);
	const primary = screen.getByText(":3000").closest("button");
	if (!primary) throw new Error("Primary action missing");
	fireEvent.click(primary);
	fireEvent.click(
		screen.getByRole("button", {
			name: "Open localhost:3000 in external browser",
		}),
	);
	fireEvent.click(screen.getByRole("button", { name: "Copy localhost:3000" }));
	fireEvent.click(screen.getByRole("button", { name: "Close port 3000" }));
	expect(actions).toEqual(["primary", "external", "copy", "close"]);
	view.rerender(<PortRowView {...props} isPending />);
	expect(
		screen
			.getByRole("button", { name: "Close port 3000" })
			.hasAttribute("disabled"),
	).toBe(true);
	expect(
		screen
			.getByRole("button", { name: "Open localhost:3000 in external browser" })
			.hasAttribute("disabled"),
	).toBe(false);
});

import { afterEach, expect, test } from "bun:test";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { TooltipProvider } from "@superset/ui/tooltip";
import { useState } from "react";
import { clampDesignModePayload } from "main/lib/browser/design-mode-payload";
import { DesignModePopoverView } from "./DesignModePopoverView";

afterEach(cleanup);
const payload = clampDesignModePayload({
	page: { sanitizedUrl: "http://localhost/owned" },
	target: { tagName: "button", textSnippet: "Owned", selector: "#owned" },
});
if (!payload) throw Error("Invalid owned payload fixture");
function Harness({
	send,
	dismiss = () => {},
	pending = false,
}: {
	send(comment: string): void;
	dismiss?(): void;
	pending?: boolean;
}) {
	const [comment, setComment] = useState("");
	return (
		<TooltipProvider>
			<DesignModePopoverView
				payload={payload!}
				style={{ top: 0, left: 0 }}
				comment={comment}
				onCommentChange={setComment}
				submitting={pending}
				canSubmit={!!comment.trim() && !pending}
				onSubmit={() => {
					if (comment.trim() && !pending) send(comment.trim());
				}}
				onDismiss={dismiss}
				agentPicker={<button type="button">Owned picker</button>}
			/>
		</TooltipProvider>
	);
}

test("the original feedback form focuses its textarea and submits trimmed text with Enter", () => {
	const sent: string[] = [];
	render(<Harness send={(text) => sent.push(text)} />);
	const input = screen.getByPlaceholderText("Describe the change…");
	expect(document.activeElement).toBe(input);
	expect(
		screen
			.getByRole("button", { name: "Send to agent" })
			.hasAttribute("disabled"),
	).toBe(true);
	fireEvent.change(input, { target: { value: "  中文 change  " } });
	fireEvent.keyDown(input, { key: "Enter" });
	expect(sent).toEqual(["中文 change"]);
});

test("IME confirmation and Shift Enter do not submit design feedback", () => {
	const sent: string[] = [];
	render(<Harness send={(text) => sent.push(text)} />);
	const input = screen.getByPlaceholderText("Describe the change…");
	fireEvent.change(input, { target: { value: "中文" } });
	fireEvent.keyDown(input, { key: "Enter", isComposing: true });
	fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
	expect(sent).toEqual([]);
});

test("Escape repicks the element without bubbling into the enclosing pane", () => {
	let dismissed = 0,
		bubbled = 0;
	render(
		<div onKeyDown={() => bubbled++}>
			<Harness send={() => {}} dismiss={() => dismissed++} />
		</div>,
	);
	fireEvent.keyDown(screen.getByPlaceholderText("Describe the change…"), {
		key: "Escape",
	});
	expect(dismissed).toBe(1);
	expect(bubbled).toBe(0);
});

test("pending feedback cannot submit another prompt", () => {
	const sent: string[] = [];
	render(<Harness pending send={(text) => sent.push(text)} />);
	const input = screen.getByPlaceholderText("Describe the change…");
	fireEvent.change(input, { target: { value: "change" } });
	fireEvent.keyDown(input, { key: "Enter" });
	fireEvent.click(screen.getByRole("button", { name: "Send to agent" }));
	expect(sent).toEqual([]);
	expect(
		screen
			.getByRole("button", { name: "Send to agent" })
			.hasAttribute("disabled"),
	).toBe(true);
});

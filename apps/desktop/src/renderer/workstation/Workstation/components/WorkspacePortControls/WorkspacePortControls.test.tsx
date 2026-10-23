import { afterEach, expect, test } from "bun:test";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { WorkspacePortControls } from "./WorkspacePortControls";

afterEach(cleanup);
test("each retained forward is displayed and closes independently", () => {
	const closed: (string | undefined)[] = [];
	const forwards = [
		{ id: "one", url: "http://127.0.0.1:1001", workspaceId: "a", port: 3000 },
		{ id: "two", url: "http://127.0.0.1:1002", workspaceId: "a", port: 4000 },
	] as const;
	render(
		<WorkspacePortControls
			busy={false}
			forward={forwards[1]}
			forwards={[...forwards]}
			onOpenPort={() => {}}
			onClosePort={(id) => closed.push(id)}
		/>,
	);
	expect(screen.getByText(forwards[0].url)).toBeTruthy();
	expect(screen.getByText(forwards[1].url)).toBeTruthy();
	const [button] = screen.getAllByRole("button", { name: "Close" });
	if (button) fireEvent.click(button);
	expect(closed).toEqual(["one"]);
});

test("an explicit empty workspace list does not display an unrelated legacy forward", () => {
	render(
		<WorkspacePortControls
			busy={false}
			forward={{ id: "other", url: "http://127.0.0.1:9000" }}
			forwards={[]}
			onOpenPort={() => {}}
			onClosePort={() => {}}
		/>,
	);
	expect(screen.queryByText("http://127.0.0.1:9000")).toBeNull();
	expect(screen.getByRole("button", { name: "Open port" })).toBeTruthy();
});

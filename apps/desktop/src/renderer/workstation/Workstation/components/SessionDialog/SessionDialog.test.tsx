import { afterEach, expect, test } from "bun:test";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { SessionDialog } from "./SessionDialog";

afterEach(cleanup);

test("project workspaces use the original checkout picker and default to their own worktree", async () => {
	const requests: unknown[][] = [];
	render(
		<SessionDialog
			canCreateWorktree
			profiles={[]}
			selectedId="remote"
			projects={[
				{ id: "project", name: "Example", repoPath: "/remote/example" },
			]}
			connected
			busy={false}
			onTarget={() => {}}
			onCreate={(...args) => requests.push(args)}
			onClose={() => {}}
		/>,
	);
	fireEvent.change(screen.getByLabelText("Name"), {
		target: { value: "Feature" },
	});
	fireEvent.change(screen.getByLabelText("Project"), {
		target: { value: "project" },
	});
	expect(
		screen.getByRole("button", { name: "Checkout: Worktree" }),
	).toBeTruthy();
	expect(screen.getByText("~/Superset Remix/worktrees/")).toBeTruthy();
	expect(
		screen
			.getByRole("switch", { name: "Run setup script" })
			.getAttribute("aria-checked"),
	).toBe("true");
	fireEvent.submit(
		screen.getByRole("button", { name: "Create" }).closest("form")!,
	);
	expect(requests).toEqual([["Feature", "project", "worktree", true]]);
	fireEvent.pointerDown(
		screen.getByRole("button", { name: "Checkout: Worktree" }),
		{ button: 0, ctrlKey: false },
	);
	fireEvent.click(await screen.findByRole("menuitem", { name: /Local/ }));
	fireEvent.submit(
		screen.getByRole("button", { name: "Create" }).closest("form")!,
	);
	expect(requests[1]).toEqual(["Feature", "project", "local", false]);
});

test("setup can be explicitly skipped and is unavailable for standalone sessions", () => {
	const requests: unknown[][] = [];
	render(
		<SessionDialog
			canCreateWorktree
			profiles={[]}
			selectedId="remote"
			projects={[
				{ id: "project", name: "Example", repoPath: "/remote/example" },
			]}
			connected
			busy={false}
			onTarget={() => {}}
			onCreate={(...args) => requests.push(args)}
			onClose={() => {}}
		/>,
	);
	expect(screen.queryByRole("switch", { name: "Run setup script" })).toBeNull();
	fireEvent.change(screen.getByLabelText("Name"), {
		target: { value: "Feature" },
	});
	fireEvent.change(screen.getByLabelText("Project"), {
		target: { value: "project" },
	});
	fireEvent.click(screen.getByRole("switch", { name: "Run setup script" }));
	fireEvent.submit(
		screen.getByRole("button", { name: "Create" }).closest("form")!,
	);
	expect(requests[0]).toEqual(["Feature", "project", "worktree", false]);
});

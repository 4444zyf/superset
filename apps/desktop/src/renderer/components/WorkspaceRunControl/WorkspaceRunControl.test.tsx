import { afterEach, expect, test } from "bun:test";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { WorkspaceRunControl } from "./WorkspaceRunControl";

afterEach(cleanup);
const definition = {
	source: "project-config" as const,
	projectId: "project",
	commands: ["echo run"],
};

test("the original empty Run control opens configuration without starting a process", () => {
	let configured = 0,
		toggled = 0;
	render(
		<WorkspaceRunControl
			definition={null}
			isRunning={false}
			isPending={false}
			canForceStop={false}
			onConfigure={() => {
				configured++;
			}}
			onToggle={() => {
				toggled++;
			}}
			onForceStop={() => {}}
		/>,
	);
	fireEvent.click(
		screen.getByRole("button", { name: "Configure workspace run command" }),
	);
	expect(configured).toBe(1);
	expect(toggled).toBe(0);
});

test("pending launches disable both original Run actions", () => {
	render(
		<WorkspaceRunControl
			definition={definition}
			isRunning={false}
			isPending
			canForceStop={false}
			onConfigure={() => {}}
			onToggle={() => {
				throw new Error("must remain disabled");
			}}
			onForceStop={() => {}}
		/>,
	);
	const run = screen.getByRole("button", {
		name: "Run workspace command",
	}) as HTMLButtonElement;
	expect(run.disabled).toBe(true);
	expect(
		(
			screen.getByRole("button", {
				name: "Workspace run options",
			}) as HTMLButtonElement
		).disabled,
	).toBe(true);
	fireEvent.click(run);
});

test("a running command keeps the original Stop and Force Stop actions", () => {
	let stopped = 0,
		forced = 0;
	render(
		<WorkspaceRunControl
			definition={definition}
			isRunning
			isPending={false}
			canForceStop
			onConfigure={() => {}}
			onToggle={() => {
				stopped++;
			}}
			onForceStop={() => {
				forced++;
			}}
		/>,
	);
	fireEvent.click(
		screen.getByRole("button", { name: "Stop workspace run command" }),
	);
	expect(stopped).toBe(1);
	fireEvent.pointerDown(
		screen.getByRole("button", { name: "Workspace run options" }),
		{ button: 0, ctrlKey: false },
	);
	fireEvent.click(screen.getByRole("menuitem", { name: "Force Stop" }));
	expect(forced).toBe(1);
});

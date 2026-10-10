import { afterEach, expect, test } from "bun:test";
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { RemoteProjectCreator } from "./RemoteProjectCreator";

afterEach(cleanup);

test("clone and empty project requests use the directory selected on B and stable operation IDs", async () => {
	const requests: unknown[] = [];
	render(
		<RemoteProjectCreator
			parentDir="/Users/service/repos"
			busy={false}
			onCreate={async (input) => {
				requests.push(input);
			}}
		/>,
	);
	fireEvent.change(screen.getByLabelText("Project name"), {
		target: { value: "sample" },
	});
	fireEvent.change(screen.getByLabelText("Repository URL or path"), {
		target: { value: "git@github.com:example/sample.git" },
	});
	fireEvent.click(screen.getByRole("button", { name: "Clone" }));
	await waitFor(() => expect(requests).toHaveLength(1));
	expect(requests[0]).toMatchObject({
		name: "sample",
		mode: {
			kind: "clone",
			parentDir: "/Users/service/repos",
			url: "git@github.com:example/sample.git",
		},
	});
	fireEvent.click(screen.getByRole("button", { name: "Create project" }));
	await waitFor(() => expect(requests).toHaveLength(2));
	expect(requests[1]).toMatchObject({
		name: "sample",
		mode: { kind: "empty", parentDir: "/Users/service/repos" },
	});
	for (const input of requests as { operationId: string }[])
		expect(input.operationId).toMatch(/^[a-f0-9-]{36}$/);
});

test("missing durable backend capability disables all repository creation actions", () => {
	render(
		<RemoteProjectCreator
			parentDir="/remote"
			busy={false}
			disabled
			onCreate={async () => {
				throw new Error("Cannot create");
			}}
		/>,
	);
	fireEvent.change(screen.getByLabelText("Project name"), {
		target: { value: "sample" },
	});
	fireEvent.change(screen.getByLabelText("Repository URL or path"), {
		target: { value: "https://example.org/sample.git" },
	});
	expect(
		(screen.getByRole("button", { name: "Clone" }) as HTMLButtonElement)
			.disabled,
	).toBe(true);
	expect(
		(
			screen.getByRole("button", {
				name: "Create project",
			}) as HTMLButtonElement
		).disabled,
	).toBe(true);
});

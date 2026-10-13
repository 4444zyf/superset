import { expect, test } from "bun:test";
import { inspectRestoreResources } from "./restore-resources";

const refs = [
	{
		workspaceId: "workspace",
		resourceId: "terminal",
		kind: "terminal" as const,
		executionId: "original",
	},
];
const rows = {
	workspace: () => ({ archived: false }),
	terminal: () => ({
		workspaceId: "workspace",
		status: "active",
		disposing: false,
	}),
	chat: async () => null,
};

test("an authoritative exited original execution remains ended without respawning", async () => {
	const result = await inspectRestoreResources(refs, rows, async () => [
		{ id: "terminal", alive: false, executionId: "original" },
	]);
	expect(result[0]?.state).toBe("exited");
});

test("an active DB row is unknown when the authoritative daemon cannot be reached", async () => {
	const result = await inspectRestoreResources(refs, rows, async () => {
		throw new Error("offline");
	});
	expect(result[0]?.state).toBe("unknown");
});

test("the same terminal ID with a different execution cannot be marked live", async () => {
	const result = await inspectRestoreResources(refs, rows, async () => [
		{ id: "terminal", alive: true, executionId: "replacement" },
	]);
	expect(result[0]).toMatchObject({
		state: "interrupted",
		reason: "execution-changed",
	});
});

test("resource ownership and archived workspaces are checked before daemon results", async () => {
	const result = await inspectRestoreResources(
		refs,
		{
			...rows,
			terminal: () => ({
				workspaceId: "other",
				status: "active",
				disposing: false,
			}),
		},
		async () => [{ id: "terminal", alive: true, executionId: "original" }],
	);
	expect(result[0]?.state).toBe("missing");
	const archived = await inspectRestoreResources(
		refs,
		{ ...rows, workspace: () => ({ archived: true }) },
		async () => [],
	);
	expect(archived[0]?.state).toBe("workspace-unavailable");
});

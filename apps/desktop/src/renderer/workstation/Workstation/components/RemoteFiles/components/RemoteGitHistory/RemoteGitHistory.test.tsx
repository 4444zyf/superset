import { afterEach, expect, test } from "bun:test";
import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import type {
	DirectDescriptor,
	DirectRpc,
	DirectWorkstationApi,
} from "../../../../../../../shared/direct-workstation";
import { RemoteGitHistory } from "./RemoteGitHistory";

afterEach(cleanup);
const connection: DirectDescriptor = {
	connectionId: "machine",
	backendId: "backend",
	namespaceId: "namespace",
	generation: 2,
	instanceId: "instance",
	capabilities: {
		git: true,
		workstationGitHistoryV1: true,
		workstationGitV1: true,
	},
};
const commit = (message: string) => ({
	hash: message === "first" ? "a".repeat(40) : "b".repeat(40),
	shortHash: message === "first" ? "aaaaaaa" : "bbbbbbb",
	message,
	author: "History Author",
	authorEmail: "history@example.invalid",
	date: "2026-10-14T00:00:00Z",
});

test("original commit rows navigate bounded pages and select the explicit commit", async () => {
	const calls: DirectRpc[] = [];
	const selected: string[] = [];
	const api = {
		rpc: async (request: DirectRpc): Promise<unknown> => {
			calls.push(request);
			const cursor = (
				request.input as { cursor?: { head: string; skip: number } }
			).cursor;
			return {
				head: "a".repeat(40),
				commits: [commit(cursor?.skip ? "second" : "first")],
				nextCursor: cursor ? null : { head: "a".repeat(40), skip: 50 },
			};
		},
	} as unknown as DirectWorkstationApi;
	render(
		<RemoteGitHistory
			api={api}
			connection={connection}
			workspaceId="workspace"
			onError={(message) => {
				throw new Error(message);
			}}
			onSelect={(entry) => selected.push(entry.hash)}
		/>,
	);
	fireEvent.click(
		await screen.findByRole("button", { name: /first.*History Author/ }),
	);
	expect(selected).toEqual(["a".repeat(40)]);
	fireEvent.click(screen.getByRole("button", { name: "Next page" }));
	await screen.findByRole("button", { name: /second.*History Author/ });
	expect(calls[1]).toMatchObject({
		connectionId: "machine",
		generation: 2,
		path: "git.listRepositoryCommitsV1",
		type: "query",
		input: {
			workspaceId: "workspace",
			limit: 50,
			cursor: { head: "a".repeat(40), skip: 50 },
		},
	});
	expect(
		(screen.getByRole("button", { name: "Next page" }) as HTMLButtonElement)
			.disabled,
	).toBe(true);
	fireEvent.click(screen.getByRole("button", { name: "Previous page" }));
	await screen.findByRole("button", { name: /first.*History Author/ });
	expect(calls).toHaveLength(3);
});

test("a late history page cannot appear after changing workspaces", async () => {
	let finish!: (value: unknown) => void;
	const api = {
		rpc: async (request: DirectRpc): Promise<unknown> =>
			(request.input as { workspaceId: string }).workspaceId === "old"
				? new Promise((resolve) => {
						finish = resolve;
					})
				: { head: null, commits: [], nextCursor: null },
	} as unknown as DirectWorkstationApi;
	const view = render(
		<RemoteGitHistory
			api={api}
			connection={connection}
			workspaceId="old"
			onError={() => {}}
			onSelect={() => {}}
		/>,
	);
	await waitFor(() => expect(finish).toBeDefined());
	view.rerender(
		<RemoteGitHistory
			api={api}
			connection={connection}
			workspaceId="new"
			onError={() => {}}
			onSelect={() => {}}
		/>,
	);
	await act(async () =>
		finish({
			head: "a".repeat(40),
			commits: [commit("first")],
			nextCursor: null,
		}),
	);
	await screen.findByText("No commits on this branch yet.");
	expect(
		screen.queryByRole("button", { name: /first.*History Author/ }),
	).toBeNull();
});

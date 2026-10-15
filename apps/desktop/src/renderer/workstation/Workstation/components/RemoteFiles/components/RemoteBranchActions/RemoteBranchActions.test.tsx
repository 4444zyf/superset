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
import { RemoteBranchActions } from "./RemoteBranchActions";

afterEach(cleanup);
const connection: DirectDescriptor = {
	connectionId: "machine",
	backendId: "backend",
	namespaceId: "namespace",
	generation: 2,
	instanceId: "instance",
	capabilities: { workstationGitV1: true, durableOperations: true },
};
const sync = {
	currentBranch: "feature",
	isDetached: false,
	hasRepo: true,
	hasUpstream: false,
	pushCount: 1,
};
function fixture(
	reply: (request: DirectRpc) => Promise<unknown> = async (request) =>
		request.type === "query" ? sync : { success: true },
) {
	const calls: DirectRpc[] = [];
	const errors: string[] = [];
	let refreshes = 0;
	return {
		calls,
		errors,
		refreshes: () => refreshes,
		props: {
			api: {
				rpc: async (request: DirectRpc) => {
					calls.push(request);
					return reply(request);
				},
			} as DirectWorkstationApi,
			connection,
			workspaceId: "workspace",
			onError: (message: string) => errors.push(message),
			onRefresh: () => {
				refreshes++;
			},
		},
	};
}
async function openRename() {
	const button = await screen.findByRole("button", { name: "Rename branch" });
	await waitFor(() =>
		expect((button as HTMLButtonElement).disabled).toBe(false),
	);
	fireEvent.click(button);
	return screen.getByLabelText("Branch name");
}
test("original rename dialog submits once, excludes IME Enter, and refreshes the selected workspace", async () => {
	let complete!: (result: unknown) => void;
	const f = fixture(async (request) =>
		request.type === "query"
			? sync
			: new Promise((resolve) => {
					complete = resolve;
				}),
	);
	render(<RemoteBranchActions {...f.props} />);
	const input = await openRename();
	fireEvent.change(input, { target: { value: "renamed" } });
	fireEvent.keyDown(input, { key: "Enter", isComposing: true });
	expect(f.calls.filter((call) => call.type === "mutation")).toHaveLength(0);
	fireEvent.click(screen.getByRole("button", { name: "Rename" }));
	fireEvent.click(screen.getByRole("button", { name: "Rename" }));
	expect(f.calls.filter((call) => call.type === "mutation")).toEqual([
		{
			connectionId: "machine",
			generation: 2,
			path: "git.renameBranch",
			type: "mutation",
			input: {
				workspaceId: "workspace",
				oldName: "feature",
				newName: "renamed",
			},
		},
	]);
	await act(async () => complete({ name: "renamed" }));
	await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
	expect(f.refreshes()).toBe(1);
});
test("a lost rename reply is confirmed by a read without another mutation", async () => {
	let renamed = false;
	const f = fixture(async (request) => {
		if (request.type === "query")
			return { ...sync, currentBranch: renamed ? "renamed" : "feature" };
		renamed = true;
		throw new Error("Reply lost");
	});
	render(<RemoteBranchActions {...f.props} />);
	fireEvent.change(await openRename(), { target: { value: "renamed" } });
	await act(async () => {
		fireEvent.click(screen.getByRole("button", { name: "Rename" }));
	});
	expect(screen.queryByRole("dialog")).toBeNull();
	expect(f.calls.filter((call) => call.type === "mutation")).toHaveLength(1);
	expect(f.calls.filter((call) => call.type === "query")).toHaveLength(2);
	expect(f.refreshes()).toBe(1);
});
test("unknown rename outcome retains its draft and requires a read before another write", async () => {
	let reads = 0;
	let available = false;
	const f = fixture(async (request) => {
		if (request.type === "mutation") throw new Error("Reply lost");
		if (++reads > 1 && !available) throw new Error("Offline");
		return sync;
	});
	render(<RemoteBranchActions {...f.props} />);
	fireEvent.change(await openRename(), { target: { value: "keep draft" } });
	fireEvent.click(screen.getByRole("button", { name: "Rename" }));
	await waitFor(() =>
		expect(
			(screen.getByRole("button", { name: "Refresh" }) as HTMLButtonElement)
				.disabled,
		).toBe(false),
	);
	expect((screen.getByLabelText("Branch name") as HTMLInputElement).value).toBe(
		"keep draft",
	);
	expect(
		(
			screen.getByRole("button", {
				name: "Rename",
			}) as HTMLButtonElement
		).disabled,
	).toBe(true);
	available = true;
	fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
	await waitFor(() =>
		expect(
			(
				screen.getByRole("button", {
					name: "Rename",
				}) as HTMLButtonElement
			).disabled,
		).toBe(false),
	);
	expect(f.calls.filter((call) => call.type === "mutation")).toHaveLength(1);
});
test("push uses one durable operation and does not resubmit after a lost reply", async () => {
	let reject!: (error: Error) => void;
	const f = fixture(async (request) =>
		request.type === "query"
			? sync
			: new Promise((_, fail) => {
					reject = fail;
				}),
	);
	render(<RemoteBranchActions {...f.props} />);
	const push = await screen.findByRole("button", { name: "Push" });
	await waitFor(() => expect((push as HTMLButtonElement).disabled).toBe(false));
	fireEvent.click(push);
	fireEvent.click(push);
	const writes = f.calls.filter((call) => call.type === "mutation");
	expect(writes).toHaveLength(1);
	expect(writes[0]).toMatchObject({
		connectionId: "machine",
		generation: 2,
		path: "git.push",
		input: {
			workspaceId: "workspace",
			operationId: expect.stringMatching(/^[a-f0-9-]{36}$/),
		},
	});
	await act(async () =>
		reject(new Error("Operation is pending; reconcile before continuing")),
	);
	expect(f.calls.filter((call) => call.type === "mutation")).toHaveLength(1);
	expect(f.errors).toEqual([
		"Operation is pending; reconcile before continuing",
	]);
});
test("upstream branches cannot be renamed and push needs durable capability and a remote", async () => {
	const f = fixture(async () => ({
		...sync,
		hasUpstream: true,
		hasRepo: false,
	}));
	const view = render(<RemoteBranchActions {...f.props} />);
	await waitFor(() => expect(f.calls).toHaveLength(1));
	expect(
		(screen.getByRole("button", { name: "Rename branch" }) as HTMLButtonElement)
			.disabled,
	).toBe(true);
	expect(
		(
			screen.getByRole("button", {
				name: "Push",
			}) as HTMLButtonElement
		).disabled,
	).toBe(true);
	view.rerender(
		<RemoteBranchActions
			{...f.props}
			connection={{
				...connection,
				generation: 3,
				capabilities: { workstationGitV1: true },
			}}
		/>,
	);
	await waitFor(() => expect(f.calls).toHaveLength(2));
	expect(
		(
			screen.getByRole("button", {
				name: "Push",
			}) as HTMLButtonElement
		).disabled,
	).toBe(true);
});
test("an old rename reply cannot close or refresh the next workspace", async () => {
	let complete!: (result: unknown) => void;
	const f = fixture(async (request) =>
		request.type === "query"
			? sync
			: new Promise((resolve) => {
					complete = resolve;
				}),
	);
	const view = render(<RemoteBranchActions {...f.props} />);
	fireEvent.change(await openRename(), { target: { value: "old workspace" } });
	fireEvent.click(screen.getByRole("button", { name: "Rename" }));
	view.rerender(<RemoteBranchActions {...f.props} workspaceId="next" />);
	await openRename();
	await act(async () => complete({ name: "old workspace" }));
	expect((screen.getByLabelText("Branch name") as HTMLInputElement).value).toBe(
		"feature",
	);
	expect(f.refreshes()).toBe(0);
});

test("a confirmed rename still refreshes its workspace when the following status read fails", async () => {
	let reads = 0;
	const f = fixture(async (request) => {
		if (request.type === "mutation") return { name: "renamed" };
		if (++reads > 1) throw new Error("Status unavailable");
		return sync;
	});
	render(<RemoteBranchActions {...f.props} />);
	fireEvent.change(await openRename(), { target: { value: "renamed" } });
	await act(async () => {
		fireEvent.click(screen.getByRole("button", { name: "Rename" }));
	});
	expect(f.refreshes()).toBe(1);
	expect(screen.queryByRole("dialog")).toBeNull();
	expect(f.calls.filter((call) => call.type === "mutation")).toHaveLength(1);
});

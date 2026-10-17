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
} from "../../../../../shared/direct-workstation";
import { RemoteWorkspaceDelete } from "./RemoteWorkspaceDelete";
afterEach(cleanup);
const connection: DirectDescriptor = {
	connectionId: "remote",
	backendId: "backend",
	namespaceId: "namespace",
	instanceId: "instance",
	generation: 3,
	capabilities: {
		workstationWorkspaceCleanupV1: true,
		durableOperations: true,
	},
};
const inspect = {
	canDelete: true,
	reason: null,
	hasChanges: true,
	hasUnpushedCommits: true,
	sharesProjectCheckout: false,
};
function fixture(
	mutate: (request: DirectRpc) => Promise<unknown> = async () => ({
		outcome: "deleted",
		warnings: [],
	}),
) {
	const calls: DirectRpc[] = [];
	const deleted: unknown[] = [];
	let closed = 0;
	const api = {
		rpc: async (r: DirectRpc) => {
			calls.push(r);
			return r.type === "query" ? inspect : mutate(r);
		},
	} as DirectWorkstationApi;
	const props = {
		api,
		connection,
		workspace: {
			id: "workspace",
			name: "To remove",
			worktreePath: "/worktrees/test",
			projectId: "project",
		},
		onClose: () => {
			closed++;
		},
		onDeleted: (warnings: string[]) => {
			deleted.push(warnings);
		},
		hasUnsavedChanges: () => false,
	};
	return { calls, deleted, props, closed: () => closed };
}
test("opening and cancelling uses the original warnings without deleting", async () => {
	const f = fixture();
	render(<RemoteWorkspaceDelete {...f.props} />);
	await screen.findByText("Has uncommitted changes and unpushed commits");
	fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
	expect(f.closed()).toBe(1);
	expect(f.calls.filter((r) => r.type === "mutation")).toHaveLength(0);
});
test("warned deletion still runs teardown and only an explicit failure retry skips it", async () => {
	const cause = {
		kind: "TEARDOWN_FAILED",
		exitCode: 17,
		signal: null,
		timedOut: false,
		outputTail: "cleanup failed",
	};
	const f = fixture(async () =>
		f.calls.filter((r) => r.type === "mutation").length === 1
			? { outcome: "teardown-failed", cause }
			: { outcome: "deleted", warnings: ["check terminal"] },
	);
	render(<RemoteWorkspaceDelete {...f.props} />);
	await screen.findByText("Has uncommitted changes and unpushed commits");
	fireEvent.click(screen.getByRole("button", { name: "Delete anyway" }));
	await screen.findByText("cleanup failed");
	expect(f.calls.filter((r) => r.type === "mutation")).toHaveLength(1);
	expect(f.calls.find((r) => r.type === "mutation")?.input).toMatchObject({
		workspaceId: "workspace",
		force: true,
		skipTeardown: false,
		deleteBranch: false,
	});
	fireEvent.click(screen.getByRole("button", { name: "Delete anyway" }));
	await waitFor(() => expect(f.deleted).toEqual([["check terminal"]]));
	const writes = f.calls.filter((r) => r.type === "mutation");
	expect(writes[1]?.input).toMatchObject({ skipTeardown: true, force: true });
	expect((writes[0]?.input as { operationId: string }).operationId).not.toBe(
		(writes[1]?.input as { operationId: string }).operationId,
	);
});
test("an uncertain deletion is not replayed by rerendering or clicking again", async () => {
	const f = fixture(async () => {
		throw new Error("Response lost");
	});
	const v = render(<RemoteWorkspaceDelete {...f.props} />);
	fireEvent.click(await screen.findByRole("button", { name: "Delete anyway" }));
	await screen.findByText("Response lost");
	v.rerender(<RemoteWorkspaceDelete {...f.props} />);
	fireEvent.click(screen.getByRole("button", { name: "Delete anyway" }));
	expect(f.calls.filter((r) => r.type === "mutation")).toHaveLength(1);
});
test("a late deletion reply cannot affect a newly selected machine", async () => {
	let finish!: (v: unknown) => void;
	const f = fixture(
		() =>
			new Promise((r) => {
				finish = r;
			}),
	);
	const v = render(<RemoteWorkspaceDelete {...f.props} />);
	fireEvent.click(await screen.findByRole("button", { name: "Delete anyway" }));
	await waitFor(() =>
		expect(f.calls.filter((r) => r.type === "mutation")).toHaveLength(1),
	);
	v.rerender(
		<RemoteWorkspaceDelete
			{...f.props}
			connection={{ ...connection, generation: 4 }}
		/>,
	);
	v.rerender(<RemoteWorkspaceDelete {...f.props} />);
	await act(async () => finish({ outcome: "deleted", warnings: [] }));
	expect(f.deleted).toEqual([]);
});
test("unsaved editor drafts block deletion and old backends receive no cleanup calls", async () => {
	const f = fixture();
	const v = render(
		<RemoteWorkspaceDelete {...f.props} hasUnsavedChanges={() => true} />,
	);
	await screen.findByText("Has uncommitted changes and unpushed commits");
	fireEvent.click(screen.getByRole("button", { name: "Delete anyway" }));
	await screen.findByText("Unsaved changes");
	expect(f.calls.filter((r) => r.type === "mutation")).toHaveLength(0);
	v.unmount();
	f.calls.length = 0;
	render(
		<RemoteWorkspaceDelete
			{...f.props}
			connection={{ ...connection, capabilities: {} }}
		/>,
	);
	expect(f.calls).toEqual([]);
});

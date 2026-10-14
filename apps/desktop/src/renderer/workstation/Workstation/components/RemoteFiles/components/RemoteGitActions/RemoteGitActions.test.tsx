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
import { RemoteGitActions } from "./RemoteGitActions";

afterEach(cleanup);
const connection: DirectDescriptor = {
	connectionId: "mini",
	generation: 4,
	backendId: "b",
	namespaceId: "n",
	instanceId: "i",
	capabilities: { workstationGitV1: true, durableOperations: true },
};
function fixture(
	reply: (request: DirectRpc) => Promise<unknown> = async () => ({
		success: true,
	}),
) {
	const calls: DirectRpc[] = [];
	const errors: string[] = [];
	let refreshes = 0;
	return {
		calls,
		errors,
		refreshes: () => refreshes,
		props: {
			connection,
			workspaceId: "ws",
			hasStagedChanges: true,
			api: {
				rpc: async (request: DirectRpc) => {
					calls.push(request);
					return reply(request);
				},
			} as DirectWorkstationApi,
			onRefresh: () => {
				refreshes++;
			},
			onError: (error: string) => errors.push(error),
		},
	};
}

test("an IME composition Enter cannot submit the commit shortcut", () => {
	const f = fixture();
	render(<RemoteGitActions {...f.props} />);
	const input = screen.getByPlaceholderText("Commit message");
	fireEvent.change(input, { target: { value: "draft" } });
	fireEvent.keyDown(input, { key: "Enter", ctrlKey: true, isComposing: true });
	expect(f.calls).toEqual([]);
});

test("a missing Git identity is configured on the current repository before the commit is enabled", async () => {
	const f = fixture(async (request) =>
		request.path === "git.getUserIdentityV1"
			? { name: null, email: null, configured: false }
			: {
					name: "Fixture Author",
					email: "fixture@example.invalid",
					configured: true,
				},
	);
	render(
		<RemoteGitActions
			{...f.props}
			connection={{
				...connection,
				capabilities: {
					...connection.capabilities,
					workstationGitIdentityV1: true,
				},
			}}
		/>,
	);
	await waitFor(() =>
		expect(f.calls.some((call) => call.path === "git.getUserIdentityV1")).toBe(
			true,
		),
	);
	fireEvent.change(screen.getByPlaceholderText("Commit message"), {
		target: { value: "commit" },
	});
	fireEvent.click(screen.getByRole("button", { name: "Commit" }));
	expect(f.calls.some((call) => call.path === "git.commit")).toBe(false);
	fireEvent.change(screen.getByLabelText("Name"), {
		target: { value: "Fixture Author" },
	});
	fireEvent.change(screen.getByLabelText("Email"), {
		target: { value: "fixture@example.invalid" },
	});
	fireEvent.click(screen.getByRole("button", { name: "Save" }));
	await waitFor(() =>
		expect(f.calls.some((call) => call.path === "git.setUserIdentityV1")).toBe(
			true,
		),
	);
	expect(
		f.calls.find((call) => call.path === "git.setUserIdentityV1"),
	).toMatchObject({
		connectionId: "mini",
		generation: 4,
		input: {
			workspaceId: "ws",
			name: "Fixture Author",
			email: "fixture@example.invalid",
		},
	});
	await waitFor(() =>
		expect(
			(screen.getByRole("button", { name: "Commit" }) as HTMLButtonElement)
				.disabled,
		).toBe(false),
	);
});

test("a new parent error callback does not refetch identity or erase its draft", async () => {
	const f = fixture(async () => ({
		name: null,
		email: null,
		configured: false,
	}));
	const target = {
		...connection,
		capabilities: {
			...connection.capabilities,
			workstationGitIdentityV1: true,
		},
	};
	const view = render(<RemoteGitActions {...f.props} connection={target} />);
	await waitFor(() => expect(f.calls).toHaveLength(1));
	fireEvent.change(screen.getByLabelText("Name"), {
		target: { value: "keep draft" },
	});
	view.rerender(
		<RemoteGitActions {...f.props} connection={target} onError={() => {}} />,
	);
	expect(f.calls).toHaveLength(1);
	expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe(
		"keep draft",
	);
});

test("an identity read finishing after an explicit save cannot disable the new valid identity", async () => {
	let finish!: (value: unknown) => void;
	const f = fixture(async (request) =>
		request.path === "git.getUserIdentityV1"
			? new Promise((resolve) => {
					finish = resolve;
				})
			: { configured: true },
	);
	render(
		<RemoteGitActions
			{...f.props}
			connection={{
				...connection,
				capabilities: {
					...connection.capabilities,
					workstationGitIdentityV1: true,
				},
			}}
		/>,
	);
	fireEvent.change(screen.getByPlaceholderText("Commit message"), {
		target: { value: "commit" },
	});
	fireEvent.change(screen.getByLabelText("Name"), {
		target: { value: "Fixture Author" },
	});
	fireEvent.change(screen.getByLabelText("Email"), {
		target: { value: "fixture@example.invalid" },
	});
	fireEvent.click(screen.getByRole("button", { name: "Save" }));
	await waitFor(() =>
		expect(
			(screen.getByRole("button", { name: "Commit" }) as HTMLButtonElement)
				.disabled,
		).toBe(false),
	);
	await act(async () => finish({ name: null, email: null, configured: false }));
	expect(
		(screen.getByRole("button", { name: "Commit" }) as HTMLButtonElement)
			.disabled,
	).toBe(false);
});

test("the original commit form commits only the staged snapshot on the selected backend", async () => {
	const f = fixture();
	render(<RemoteGitActions {...f.props} />);
	fireEvent.change(screen.getByPlaceholderText("Commit message"), {
		target: { value: "Keep other edits unstaged" },
	});
	fireEvent.click(screen.getByRole("button", { name: "Commit" }));
	await waitFor(() => expect(f.calls).toHaveLength(1));
	expect(f.calls[0]).toMatchObject({
		connectionId: "mini",
		generation: 4,
		path: "git.commit",
		type: "mutation",
		input: {
			workspaceId: "ws",
			stageAll: false,
			message: "Keep other edits unstaged",
		},
	});
	expect((f.calls[0].input as { operationId: string }).operationId).toMatch(
		/^[0-9a-f-]{36}$/,
	);
	await waitFor(() => expect(f.refreshes()).toBe(1));
	expect(
		(screen.getByPlaceholderText("Commit message") as HTMLTextAreaElement)
			.value,
	).toBe("");
});

test("double submission locks one operation while a newer message remains editable", async () => {
	let finish!: (value: unknown) => void;
	const f = fixture(
		() =>
			new Promise((resolve) => {
				finish = resolve;
			}),
	);
	render(<RemoteGitActions {...f.props} />);
	const input = screen.getByPlaceholderText("Commit message");
	fireEvent.change(input, { target: { value: "first" } });
	fireEvent.click(screen.getByRole("button", { name: "Commit" }));
	fireEvent.keyDown(input, { key: "Enter", ctrlKey: true });
	fireEvent.change(input, { target: { value: "next commit draft" } });
	await act(async () => finish({ success: true }));
	expect(f.calls).toHaveLength(1);
	expect((input as HTMLTextAreaElement).value).toBe("next commit draft");
});

test("unknown delivery keeps the message without resubmitting a commit", async () => {
	const f = fixture(async () => {
		throw new Error("Response lost; reconcile pending operation");
	});
	render(<RemoteGitActions {...f.props} />);
	const input = screen.getByPlaceholderText("Commit message");
	fireEvent.change(input, { target: { value: "keep this" } });
	fireEvent.click(screen.getByRole("button", { name: "Commit" }));
	await waitFor(() => expect(f.errors).toHaveLength(1));
	expect((input as HTMLTextAreaElement).value).toBe("keep this");
	expect(f.calls).toHaveLength(1);
	expect(f.refreshes()).toBe(0);
});

test("an older backend and an empty staged selection cannot trigger a commit shortcut", () => {
	const f = fixture();
	const view = render(
		<RemoteGitActions {...f.props} hasStagedChanges={false} />,
	);
	const input = screen.getByPlaceholderText("Commit message");
	fireEvent.change(input, { target: { value: "draft" } });
	fireEvent.keyDown(input, { key: "Enter", metaKey: true });
	view.rerender(
		<RemoteGitActions
			{...f.props}
			connection={{ ...connection, capabilities: { git: true } }}
		/>,
	);
	fireEvent.keyDown(screen.getByPlaceholderText("Commit message"), {
		key: "Enter",
		metaKey: true,
	});
	expect(f.calls).toEqual([]);
});

test("a completed reply from the previous workspace cannot clear the current draft or refresh it", async () => {
	let finish!: (value: unknown) => void;
	const f = fixture(
		() =>
			new Promise((resolve) => {
				finish = resolve;
			}),
	);
	const view = render(<RemoteGitActions {...f.props} />);
	fireEvent.change(screen.getByPlaceholderText("Commit message"), {
		target: { value: "previous" },
	});
	fireEvent.click(screen.getByRole("button", { name: "Commit" }));
	view.rerender(<RemoteGitActions {...f.props} workspaceId="next" />);
	fireEvent.change(screen.getByPlaceholderText("Commit message"), {
		target: { value: "current" },
	});
	await act(async () => finish({ success: true }));
	expect(
		(screen.getByPlaceholderText("Commit message") as HTMLTextAreaElement)
			.value,
	).toBe("current");
	expect(f.refreshes()).toBe(0);
});

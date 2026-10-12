import { afterEach, expect, test } from "bun:test";
import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
	within,
} from "@testing-library/react";
import type {
	DirectConnectionEvent,
	DirectWorkstationApi,
} from "../../../shared/direct-workstation";
import { Workstation } from "./Workstation";

afterEach(cleanup);

test("switching panes and reconnecting preserves the unsent chat draft without submitting it", async () => {
	const f = fixture();
	let listener!: (event: DirectConnectionEvent) => void;
	const connect = f.api.connect,
		rpc = f.api.rpc;
	const descriptor = {
		...(await connect("mini")),
		capabilities: { sessions: true, durableOperations: true, chat: true },
		chatHarnesses: [{ id: "codex", available: true }],
	};
	f.api.connect = async () => descriptor;
	f.api.rpc = async (request) =>
		request.path === "chat.listSessions"
			? ([{ sessionId: "chat", harness: "codex" }] as never)
			: rpc(request);
	f.api.onSocket = () => () => {};
	f.api.openSocket = async () => {};
	f.api.closeSocket = async () => {};
	f.api.onConnection = (callback) => {
		listener = callback;
		return () => {};
	};
	render(<Workstation api={f.api} />);
	fireEvent.click(await screen.findByRole("button", { name: "Connect" }));
	fireEvent.click(await screen.findByRole("button", { name: "mini session" }));
	const input = await screen.findByLabelText("Message");
	fireEvent.change(input, { target: { value: "Keep this draft" } });
	fireEvent.click(screen.getByRole("button", { name: "Terminal" }));
	fireEvent.click(screen.getByRole("button", { name: "Chat" }));
	expect(
		((await screen.findByLabelText("Message")) as HTMLTextAreaElement).value,
	).toBe("Keep this draft");
	act(() =>
		listener({
			kind: "reconnecting",
			connectionId: "mini",
			previousGeneration: 1,
			attempt: 1,
		}),
	);
	act(() =>
		listener({
			kind: "connected",
			connectionId: "mini",
			previousGeneration: 1,
			descriptor: { ...descriptor, generation: 2 },
		}),
	);
	expect(
		((await screen.findByLabelText("Message")) as HTMLTextAreaElement).value,
	).toBe("Keep this draft");
	expect(f.calls.filter((c) => c.type === "mutation")).toEqual([]);
});

function fixture() {
	const calls: {
		connectionId: string;
		path: string;
		type: string;
		input?: unknown;
	}[] = [];
	const controls: string[] = [];
	const disconnected: string[] = [];
	const profiles = [
		{ id: "mini", name: "Studio Mac mini", host: "mini.example" },
		{ id: "linux", name: "Linux Build", host: "build.example" },
	];
	const api = {
		platform: "linux",
		list: async () => profiles,
		connect: async (id: string) => ({
			connectionId: id,
			generation: 1,
			backendId: id,
			namespaceId: id,
			instanceId: id,
			capabilities: { projects: true, sessions: true, durableOperations: true },
		}),
		disconnect: async (id: string) => {
			disconnected.push(id);
		},
		control: async (_id: string, action: string) => {
			controls.push(action);
			return { status: "completed" };
		},
		rpc: async (request: (typeof calls)[number]) => {
			calls.push(request);
			if (request.path === "project.list")
				return [
					{
						id: `${request.connectionId}-project`,
						name: `${request.connectionId} project`,
						repoPath: "/repo",
					},
				];
			if (request.path === "workspace.list")
				return [
					{
						id: `${request.connectionId}-session`,
						name: `${request.connectionId} session`,
						worktreePath: "/repo",
						projectId: `${request.connectionId}-project`,
					},
				];
			if (request.path === "terminal.list") return { sessions: [] };
			if (request.path === "workspaces.create")
				return {
					workspace: {
						id: `${request.connectionId}-session`,
						name: "Created",
						worktreePath: "/repo",
					},
				};
			return [];
		},
	} as unknown as DirectWorkstationApi;
	return { api, calls, controls, disconnected };
}

test("SSH machines have a separate page and connection fields appear only in its drawer", async () => {
	render(<Workstation api={fixture().api} />);
	await screen.findByRole("heading", { name: "SSH machines" });
	expect(screen.queryByLabelText("SSH host")).toBeNull();
	fireEvent.click(screen.getByRole("button", { name: "Add machine" }));
	expect(
		await screen.findByRole("dialog", { name: "Add machine" }),
	).toBeTruthy();
	expect(screen.getByLabelText("SSH host")).toBeTruthy();
});

test("moving from one SSH machine to another disconnects transport without stopping workloads", async () => {
	const f = fixture();
	render(<Workstation api={f.api} />);
	fireEvent.click(await screen.findByRole("button", { name: "Connect" }));
	await screen.findByRole("button", { name: "mini session" });
	fireEvent.click(
		within(screen.getByRole("navigation")).getByRole("button", {
			name: "SSH machines",
		}),
	);
	fireEvent.click(screen.getByRole("button", { name: "Linux Build" }));
	fireEvent.click(screen.getByRole("button", { name: "Connect" }));
	await screen.findByRole("button", { name: "linux session" });
	expect(f.disconnected).toEqual(["mini"]);
	expect(f.controls).toEqual([]);
	expect(screen.queryByRole("button", { name: "mini session" })).toBeNull();
});

test("session creation reads only the selected machine's projects and submits to that machine", async () => {
	const f = fixture();
	render(<Workstation api={f.api} />);
	fireEvent.click(await screen.findByRole("button", { name: "Connect" }));
	await screen.findByRole("button", { name: "mini session" });
	fireEvent.click(screen.getByRole("button", { name: "New session" }));
	const dialog = await screen.findByRole("dialog", { name: "New session" });
	fireEvent.change(within(dialog).getByLabelText("Run on"), {
		target: { value: "linux" },
	});
	await waitFor(() =>
		expect(within(dialog).getByLabelText("Project").textContent).toContain(
			"linux project",
		),
	);
	expect(within(dialog).getByLabelText("Project").textContent).not.toContain(
		"mini project",
	);
	fireEvent.change(within(dialog).getByLabelText("Name"), {
		target: { value: "Remote task" },
	});
	fireEvent.change(within(dialog).getByLabelText("Project"), {
		target: { value: "linux-project" },
	});
	fireEvent.click(within(dialog).getByRole("button", { name: "Create" }));
	await waitFor(() =>
		expect(f.calls.filter((c) => c.type === "mutation")).toHaveLength(1),
	);
	expect(f.calls.find((c) => c.type === "mutation")).toMatchObject({
		connectionId: "linux",
		path: "workspaces.create",
		input: { name: "Remote task", projectId: "linux-project" },
	});
	expect(f.controls).toEqual([]);
});

test("failed destination connection cannot create a session against the previous machine", async () => {
	const f = fixture();
	const connect = f.api.connect;
	f.api.connect = async (id) => {
		if (id === "linux") throw new Error("offline");
		return connect(id);
	};
	render(<Workstation api={f.api} />);
	fireEvent.click(await screen.findByRole("button", { name: "Connect" }));
	await screen.findByRole("button", { name: "mini session" });
	fireEvent.click(screen.getByRole("button", { name: "New session" }));
	const dialog = await screen.findByRole("dialog", { name: "New session" });
	fireEvent.change(within(dialog).getByLabelText("Run on"), {
		target: { value: "linux" },
	});
	await screen.findByText("offline");
	expect(
		(
			within(dialog).getByRole("button", {
				name: "Create",
			}) as HTMLButtonElement
		).disabled,
	).toBe(true);
	expect(f.calls.filter((c) => c.type === "mutation")).toEqual([]);
});

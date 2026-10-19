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
	DirectDescriptor,
	DirectLocalDataApi,
	DirectProfile,
	DirectWorkstationApi,
} from "../../../shared/direct-workstation";
import { Workstation } from "./Workstation";

afterEach(cleanup);

test.each([
	true,
	false,
])("creating a project workspace respects the selected backend's managed worktree capability (%s)", async (managedWorktrees) => {
	const mutations: { path: string; input: unknown }[] = [];
	const descriptor = {
		connectionId: "machine",
		generation: 1,
		backendId: "backend",
		namespaceId: "namespace",
		instanceId: "instance",
		capabilities: {
			projects: true,
			sessions: true,
			durableOperations: true,
			workstationManagedWorktreesV1: managedWorktrees,
		},
	};
	const api = {
		list: async () => [
			{ id: "machine", kind: "ssh", name: "Remote", host: "test.invalid" },
		],
		connect: async () => descriptor,
		listPending: async () => [],
		rpc: async (request: { path: string; type: string; input: unknown }) => {
			if (request.type === "mutation") mutations.push(request);
			if (request.path === "project.list")
				return [
					{ id: "project", name: "Example", repoPath: "/remote/example" },
				];
			if (request.path === "workspaces.create")
				return {
					...(managedWorktrees
						? { setupWarnings: ["Setup terminal unavailable"] }
						: {}),
					workspace: {
						id: "new-workspace",
						name: "Feature",
						worktreePath: "/remote/Superset Remix/worktrees/Example/Feature",
					},
				};
			if (request.path === "terminal.list") return { sessions: [] };
			return [];
		},
	} as unknown as DirectWorkstationApi;
	render(<Workstation api={api} />);
	fireEvent.click(await screen.findByRole("button", { name: "Connect" }));
	fireEvent.click(
		(await screen.findAllByRole("button", { name: "New session" }))[0],
	);
	fireEvent.change(screen.getByLabelText("Name"), {
		target: { value: "Feature" },
	});
	fireEvent.change(screen.getByLabelText("Project"), {
		target: { value: "project" },
	});
	fireEvent.click(screen.getByRole("button", { name: "Create" }));
	await waitFor(() => expect(mutations).toHaveLength(1));
	expect(mutations[0]).toMatchObject({
		connectionId: "machine",
		generation: 1,
		path: "workspaces.create",
		input: {
			name: "Feature",
			projectId: "project",
			checkout: managedWorktrees ? "worktree" : "local",
			runSetup: managedWorktrees,
		},
	});
	if (managedWorktrees) await screen.findByText(/Setup terminal unavailable/);
});

test("selecting another local namespace clears the old workspace without reconnecting or stopping workloads", async () => {
	let selected = "old";
	let connects = 0;
	const controls: string[] = [];
	const namespaces = [
		{
			id: "old",
			label: "Original",
			namespaceId: "old",
			backendId: "backend",
			selected: true,
			isDefault: true,
		},
		{
			id: "new",
			label: "Other work",
			namespaceId: "new",
			backendId: "other-backend",
			selected: false,
			isDefault: false,
		},
	];
	const localData: DirectLocalDataApi = {
		listNamespaces: async () =>
			namespaces.map((row) => ({ ...row, selected: row.id === selected })),
		selectNamespace: async (id) => {
			selected = id;
			const namespace = namespaces.find((row) => row.id === id);
			if (!namespace) throw new Error("Unknown namespace");
			return {
				...namespace,
				selected: true,
			};
		},
		createNamespace: async () => {
			throw new Error("Unexpected creation");
		},
		removeNamespace: async () => {},
		discoverLegacySources: async () => ({ sources: [], issues: [] }),
		previewLegacySources: async () => ({
			sources: [],
			conflicts: [],
			conflictCount: 0,
			conflictsTruncated: false,
			strategy: "separate-namespaces",
		}),
		importSource: async () => ({ status: "cancelled" }),
		listLegacyHistory: async () => ({ entries: [], total: 0 }),
		readLegacyHistory: async () => {
			throw new Error("No history selected");
		},
	};
	const api = {
		platform: "linux",
		localData,
		list: async () => [
			{ id: "local", kind: "local", name: "Local Device", host: "localhost" },
		],
		connect: async () => {
			connects++;
			return {
				connectionId: "local",
				generation: 1,
				backendId: "backend",
				namespaceId: "old",
				instanceId: "instance",
				capabilities: { projects: true, sessions: true },
			};
		},
		control: async (_id: string, action: string) => {
			controls.push(action);
		},
		rpc: async (request: { path: string }) =>
			request.path === "workspace.list"
				? [{ id: "workspace", name: "Old local session", worktreePath: "/old" }]
				: request.path === "project.list"
					? [{ id: "project", name: "Old local project", repoPath: "/old" }]
					: request.path === "terminal.list"
						? { sessions: [] }
						: [],
	} as unknown as DirectWorkstationApi;
	render(<Workstation api={api} />);
	fireEvent.click(await screen.findByRole("button", { name: "Connect" }));
	await screen.findByRole("button", { name: "Old local session" });
	fireEvent.click(
		within(screen.getByRole("navigation")).getByRole("button", {
			name: "SSH machines",
		}),
	);
	fireEvent.click(
		await screen.findByRole("button", { name: "Connection details" }),
	);
	const selector = await screen.findByLabelText("Local namespace");
	await act(async () =>
		fireEvent.change(selector, { target: { value: "new" } }),
	);
	expect(
		Boolean(screen.queryByRole("button", { name: "Old local session" })),
	).toBe(false);
	expect(Boolean(screen.queryByText("Old local project"))).toBe(false);
	expect(connects).toBe(1);
	expect(controls).toEqual([]);
});

test("a pending local connection cannot return after namespace selection changed away and back", async () => {
	let selected = "old";
	let finishConnect!: (descriptor: DirectDescriptor) => void;
	let connects = 0;
	const requests: string[] = [];
	const rows = [
		{
			id: "old",
			namespaceId: "old",
			backendId: "backend",
			label: "Original",
			isDefault: true,
		},
		{
			id: "new",
			namespaceId: "new",
			backendId: "other",
			label: "Other work",
			isDefault: false,
		},
	];
	const localData = {
		listNamespaces: async () =>
			rows.map((row) => ({ ...row, selected: row.id === selected })),
		selectNamespace: async (id: string) => {
			selected = id;
			const row = rows.find((item) => item.id === id);
			if (!row) throw new Error("Unknown namespace");
			return { ...row, selected: true };
		},
		listLegacyHistory: async () => ({ entries: [], total: 0 }),
	} as unknown as DirectLocalDataApi;
	const api = {
		platform: "linux",
		localData,
		list: async () => [
			{ id: "local", kind: "local", name: "Local Device", host: "localhost" },
		],
		connect: () => {
			connects++;
			return new Promise<DirectDescriptor>((resolve) => {
				finishConnect = resolve;
			});
		},
		rpc: async (request: { path: string }) => {
			requests.push(request.path);
			return [];
		},
	} as unknown as DirectWorkstationApi;
	render(<Workstation api={api} />);
	fireEvent.click(
		await screen.findByRole("button", { name: "Connection details" }),
	);
	const selector = await screen.findByLabelText("Local namespace");
	fireEvent.click(screen.getByRole("button", { name: "Connect" }));
	await act(async () =>
		fireEvent.change(selector, { target: { value: "new" } }),
	);
	await act(async () =>
		fireEvent.change(selector, { target: { value: "old" } }),
	);
	await act(async () =>
		finishConnect({
			connectionId: "local",
			generation: 1,
			backendId: "backend",
			namespaceId: "old",
			instanceId: "instance",
		}),
	);
	expect(Boolean(screen.queryByRole("button", { name: "Disconnect" }))).toBe(
		false,
	);
	expect(requests).toEqual([]);
	expect(connects).toBe(1);
});

test("workstation opens without a Superset account and saves only SSH connection settings", async () => {
	const saved: unknown[] = [];
	const api = {
		list: async () => [],
		save: async (profile: DirectProfile) => {
			saved.push(profile);
			return profile;
		},
	} as unknown as DirectWorkstationApi;
	render(<Workstation api={api} />);
	await screen.findByRole("heading", { name: "SSH machines" });
	fireEvent.click(screen.getAllByRole("button", { name: "Add machine" })[0]);
	fireEvent.change(screen.getByLabelText("Name"), {
		target: { value: "Mac mini" },
	});
	fireEvent.change(screen.getByLabelText("SSH host"), {
		target: { value: "mini.local" },
	});
	fireEvent.click(screen.getByRole("button", { name: "Add connection" }));
	await waitFor(() => expect(saved).toHaveLength(1));
	expect(saved[0]).toMatchObject({ name: "Mac mini", host: "mini.local" });
	expect(JSON.stringify(saved)).not.toMatch(/password|token|organization/i);
	cleanup();
});

test("refresh rechecks remote CLI readiness without reconnecting the SSH backend", async () => {
	const descriptor = {
		connectionId: "machine",
		generation: 1,
		backendId: "backend",
		namespaceId: "namespace",
		instanceId: "instance",
		capabilities: {
			projects: true,
			sessions: true,
			chat: true,
			durableOperations: true,
		},
		chatHarnesses: [{ id: "codex", available: false }],
	};
	let rechecks = 0;
	const api = {
		list: async () => [{ id: "machine", name: "Mac mini", host: "mini.local" }],
		connect: async () => descriptor,
		refreshFeatures: async () => {
			rechecks += 1;
			return {
				...descriptor,
				chatHarnesses: [{ id: "codex", available: true }],
			};
		},
		rpc: async (request: { path: string }) =>
			request.path === "workspace.list"
				? [{ id: "workspace", name: "Remote session", worktreePath: "/remote" }]
				: request.path === "terminal.list"
					? { sessions: [] }
					: [],
	} as unknown as DirectWorkstationApi;
	render(<Workstation api={api} />);
	fireEvent.click(await screen.findByRole("button", { name: "Connect" }));
	fireEvent.click(
		await screen.findByRole("button", { name: "Remote session" }),
	);
	const newChat = await screen.findByRole("button", { name: "New chat" });
	expect((newChat as HTMLButtonElement).disabled).toBe(true);
	fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
	await waitFor(() =>
		expect(
			(screen.getByRole("button", { name: "New chat" }) as HTMLButtonElement)
				.disabled,
		).toBe(false),
	);
	expect(rechecks).toBe(1);
});

test("a manually entered project path is browsed on the selected SSH backend", async () => {
	const paths: unknown[] = [];
	const api = {
		list: async () => [{ id: "machine", name: "Mac mini", host: "mini.local" }],
		connect: async () => ({
			connectionId: "machine",
			generation: 1,
			backendId: "backend",
			namespaceId: "namespace",
			instanceId: "instance",
			capabilities: { projects: true, durableOperations: true },
		}),
		rpc: async (request: { path: string; input?: { path?: string } }) => {
			if (request.path === "filesystem.browseHost") {
				paths.push(request.input);
				return {
					path: request.input?.path ?? "/Users/service/repos",
					parentPath: null,
					entries: [],
				};
			}
			return [];
		},
	} as unknown as DirectWorkstationApi;
	render(<Workstation api={api} />);
	fireEvent.click(await screen.findByRole("button", { name: "Connect" }));
	fireEvent.click(await screen.findByRole("button", { name: "Add project" }));
	const path = await screen.findByLabelText("Path");
	fireEvent.change(path, {
		target: { value: "/Users/service/other-projects" },
	});
	fireEvent.click(screen.getByRole("button", { name: "Open" }));
	await waitFor(() =>
		expect(paths).toEqual([{}, { path: "/Users/service/other-projects" }]),
	);
});

test("automatic reconnect retains the workspace and rejects stale connection events without replaying mutations", async () => {
	let listener!: (event: DirectConnectionEvent) => void;
	const calls: { path: string; type: string; generation: number }[] = [];
	const descriptor = {
		connectionId: "machine",
		generation: 1,
		backendId: "backend",
		namespaceId: "namespace",
		instanceId: "instance",
		capabilities: { sessions: true, durableOperations: true },
	};
	const api = {
		list: async () => [{ id: "machine", name: "Mac mini", host: "mini.local" }],
		connect: async () => descriptor,
		onConnection: (callback: (event: DirectConnectionEvent) => void) => {
			listener = callback;
			return () => {};
		},
		rpc: async (request: {
			path: string;
			type: string;
			generation: number;
		}) => {
			calls.push(request);
			return request.path === "workspace.list"
				? [
						{
							id: "workspace",
							name: "Remote session",
							worktreePath: "/remote/project",
						},
					]
				: request.path === "terminal.list"
					? { sessions: [] }
					: [];
		},
	} as unknown as DirectWorkstationApi;
	render(<Workstation api={api} />);
	fireEvent.click(await screen.findByRole("button", { name: "Connect" }));
	fireEvent.click(
		await screen.findByRole("button", { name: "Remote session" }),
	);
	await screen.findByText("/remote/project");
	act(() =>
		listener({
			kind: "reconnecting",
			connectionId: "machine",
			previousGeneration: 1,
			attempt: 1,
		}),
	);
	expect(
		screen.getByRole("button", { name: "New session" }).closest("fieldset")
			?.disabled,
	).toBe(true);
	act(() =>
		listener({
			kind: "connected",
			connectionId: "machine",
			previousGeneration: 1,
			descriptor: { ...descriptor, generation: 3 },
		}),
	);
	await waitFor(() =>
		expect(calls.filter((request) => request.generation === 3)).toHaveLength(2),
	);
	expect(screen.getByText("/remote/project")).toBeTruthy();
	act(() =>
		listener({
			kind: "blocked",
			connectionId: "machine",
			previousGeneration: 1,
			error: "stale failure",
		}),
	);
	expect(screen.queryByText("stale failure")).toBeNull();
	expect(calls.every((request) => request.type === "query")).toBe(true);
});

test("opening a development server submits its port for forwarding on B", async () => {
	const forwards: unknown[] = [];
	const descriptor = {
		connectionId: "machine",
		generation: 1,
		backendId: "backend",
		namespaceId: "namespace",
		instanceId: "instance",
	};
	const api = {
		list: async () => [{ id: "machine", name: "Mac mini", host: "mini.local" }],
		connect: async () => descriptor,
		openPort: async (...args: unknown[]) => {
			forwards.push(args);
			return { id: "forward", url: "http://127.0.0.1:1000" };
		},
		rpc: async (request: { path: string }) =>
			request.path === "workspace.list"
				? [{ id: "workspace", name: "Remote session", worktreePath: "/remote" }]
				: request.path === "terminal.list"
					? { sessions: [] }
					: [],
	} as unknown as DirectWorkstationApi;
	render(<Workstation api={api} />);
	fireEvent.click(await screen.findByRole("button", { name: "Connect" }));
	fireEvent.click(
		await screen.findByRole("button", { name: "Remote session" }),
	);
	const open = await screen.findByRole("button", { name: "Open port" });
	const input = open.closest("form")?.querySelector("input");
	if (!input) throw new Error("Port field missing");
	fireEvent.change(input, { target: { value: "3000" } });
	fireEvent.click(open);
	await waitFor(() =>
		expect(forwards).toEqual([[descriptor, "workspace", 3000]]),
	);
});

test("local data import waits for an explicit stop and never starts the backend automatically", async () => {
	const imports: string[] = [];
	const controls: string[] = [];
	const api = {
		list: async () => [
			{ id: "local", kind: "local", name: "Local Device", host: "localhost" },
		],
		connect: async () => ({
			connectionId: "local",
			generation: 1,
			backendId: "backend",
			namespaceId: "namespace",
			instanceId: "instance",
		}),
		control: async (_id: string, action: string) => {
			controls.push(action);
			return { status: "completed" };
		},
		importLocalData: async (id: string) => {
			imports.push(id);
			return {
				projects: 2,
				warnings: ["Some terminal history is unavailable."],
			};
		},
		rpc: async () => [],
	} as unknown as DirectWorkstationApi;
	render(<Workstation api={api} />);
	fireEvent.click(await screen.findByRole("button", { name: "Connect" }));
	fireEvent.click(
		within(screen.getByRole("navigation")).getByRole("button", {
			name: "SSH machines",
		}),
	);
	fireEvent.click(
		await screen.findByRole("button", { name: "Connection details" }),
	);
	const button = await screen.findByRole("button", {
		name: "Import local data",
	});
	await waitFor(() =>
		expect((button as HTMLButtonElement).disabled).toBe(true),
	);
	fireEvent.click(screen.getByRole("button", { name: "Stop" }));
	await waitFor(() =>
		expect((button as HTMLButtonElement).disabled).toBe(false),
	);
	fireEvent.click(button);
	await waitFor(() => expect(imports).toEqual(["local"]));
	await screen.findByText(
		/Local data imported\. Start the backend to use it\./,
	);
	expect(document.body.textContent).toContain(
		"Some terminal history is unavailable.",
	);
	expect(controls).toEqual(["stop"]);
});

function pendingApi(
	reconcile: () => Promise<unknown[]>,
	acknowledge: () => Promise<boolean> = async () => false,
): DirectWorkstationApi {
	return {
		list: async () => [{ id: "machine", name: "Mac mini", host: "mini.local" }],
		connect: async () => ({
			connectionId: "machine",
			generation: 1,
			backendId: "backend",
			namespaceId: "namespace",
			instanceId: "instance",
		}),
		rpc: async () => [],
		reconcile,
		acknowledge,
	} as unknown as DirectWorkstationApi;
}

test("checking an empty operation journal shows a readable result", async () => {
	render(<Workstation api={pendingApi(async () => [])} />);
	fireEvent.click(await screen.findByRole("button", { name: "Connect" }));
	fireEvent.click(
		await screen.findByRole("button", { name: "Check pending action" }),
	);
	await screen.findByText("No pending actions.");
	expect(screen.queryByText("[]")).toBeNull();
});

test("pending actions show their purpose and retain unresolved work when acknowledgement is cancelled", async () => {
	let confirmations = 0;
	const api = pendingApi(
		async () => [
			{
				operationId: "operation",
				procedure: "project.create",
				status: "unresolved",
				result: {
					namespaceId: "private-namespace",
					journalPath: "/private/journal",
				},
			},
		],
		async () => ++confirmations > 1,
	);
	render(<Workstation api={api} />);
	fireEvent.click(await screen.findByRole("button", { name: "Connect" }));
	fireEvent.click(
		await screen.findByRole("button", { name: "Check pending action" }),
	);
	await screen.findByText("Create project");
	await screen.findByText("Unresolved");
	expect(document.body.textContent).not.toContain("private-namespace");
	expect(document.body.textContent).not.toContain("/private/journal");
	await act(async () => {
		fireEvent.click(
			screen.getByRole("button", { name: "Acknowledge unresolved action" }),
		);
	});
	expect(screen.getByText("Cancelled")).toBeTruthy();
	expect(screen.getByText("Unresolved")).toBeTruthy();
	await act(async () => {
		fireEvent.click(
			screen.getByRole("button", { name: "Acknowledge unresolved action" }),
		);
	});
	expect(screen.queryByText("Unresolved")).toBeNull();
	expect(confirmations).toBe(2);
});

test("offline chat drafts remain reviewable and explicitly discardable without a connection or session", async () => {
	const browser = (
		window as unknown as { happyDOM: { setURL(url: string): void } }
	).happyDOM;
	const previousUrl = window.location.href;
	browser.setURL(
		"file:///workspace/superset/apps/desktop/dist/renderer/index.html",
	);
	const identity = {
		connectionId: "unavailable-machine",
		backendId: "replaced-backend",
		namespaceId: "old-namespace",
		workspaceId: "removed-workspace",
		sessionId: "removed-session",
	};
	let snapshot = {
		revision: 2,
		invalid: false,
		entries: [
			{
				identity,
				value: {
					text: "recover 中文 🙂\nunsent",
					attachments: [
						{
							attachmentId: "opaque",
							originalFilename: "keep.png",
							mediaType: "image/png",
							sizeBytes: 7,
						},
					],
				},
			},
			{
				identity: { ...identity, backendId: "current-backend" },
				value: { text: "different backend draft", attachments: [] },
			},
		],
	};
	const remoteCalls: string[] = [];
	const api = {
		list: async () => [],
		getChatDrafts: async () => snapshot,
		saveChatDrafts: async (input: {
			expectedRevision: number;
			entries: typeof snapshot.entries;
		}) => {
			expect(input.expectedRevision).toBe(snapshot.revision);
			snapshot = {
				...snapshot,
				revision: snapshot.revision + 1,
				entries: input.entries,
			};
			return snapshot;
		},
		connect: async () => {
			remoteCalls.push("connect");
			throw new Error("offline");
		},
		rpc: async () => {
			remoteCalls.push("rpc");
			throw new Error("offline");
		},
		readAttachment: async () => {
			remoteCalls.push("download");
			throw new Error("offline");
		},
	} as unknown as DirectWorkstationApi;
	const view = render(<Workstation api={api} />);
	try {
		fireEvent.click(await screen.findByRole("button", { name: "Chat drafts" }));
		const area = await screen.findByDisplayValue(/recover 中文 🙂\sunsent/);
		expect((area as HTMLTextAreaElement).readOnly).toBe(true);
		expect((area as HTMLTextAreaElement).value).toBe("recover 中文 🙂\nunsent");
		expect(
			screen.getByRole("button", { name: "keep.png" }).hasAttribute("disabled"),
		).toBe(true);
		expect(remoteCalls).toEqual([]);
		const article = area.closest("article")!;
		fireEvent.click(
			within(article).getByRole("button", { name: "Discard changes" }),
		);
		const confirmation = await screen.findByRole("alertdialog");
		fireEvent.click(
			within(confirmation).getByRole("button", { name: "Cancel" }),
		);
		expect(snapshot.entries).toHaveLength(2);
		fireEvent.click(
			within(article).getByRole("button", { name: "Discard changes" }),
		);
		await act(async () =>
			fireEvent.click(
				within(await screen.findByRole("alertdialog")).getByRole("button", {
					name: "Discard changes",
				}),
			),
		);
		await waitFor(() => expect(snapshot.entries).toHaveLength(1));
		expect(snapshot.entries[0]?.identity.backendId).toBe("current-backend");
		fireEvent.click(screen.getByRole("button", { name: "Close" }));
		fireEvent.click(screen.getByRole("button", { name: "Chat drafts" }));
		await screen.findByDisplayValue("different backend draft");
		expect(screen.queryByDisplayValue(/recover 中文 🙂\sunsent/)).toBeNull();
		expect(remoteCalls).toEqual([]);
	} finally {
		view.unmount();
		browser.setURL(previousUrl);
	}
});

test("a local workspace opens in the original shared workspace window when restore is supported", async () => {
	let snapshot: import("../../../shared/workspace-view").WorkspaceViewSnapshot = {
		schemaVersion: 1 as const,
		revision: 1,
		updatedAt: 1,
		restoreOnLaunch: false,
		activeConnectionId: "local",
		window: { x: 0, y: 0, width: 1200, height: 900, maximized: false },
		targets: [
			{
				connectionId: "local",
				targetRevision: 1,
				backendId: "backend",
				namespaceId: "namespace",
				serviceUid: 1000,
				autoConnect: true,
				activeTabId: null as string | null,
				workspaces:
					[] as import("../../../shared/workspace-view").WorkspaceView[],
			},
		],
	};
	const mutations: string[] = [];
	const api = {
		platform: "linux",
		list: async () => [
			{ id: "local", kind: "local", name: "Local", host: "localhost" },
		],
		connect: async () => ({
			connectionId: "local",
			generation: 1,
			backendId: "backend",
			namespaceId: "namespace",
			instanceId: "instance",
			capabilities: { workspaceViewRestoreV1: true },
		}),
		getWorkspaceView: async () => ({
			revision: snapshot.revision,
			snapshot,
			invalid: false,
			navigationRevision: 0,
		}),
		saveWorkspaceView: async (input: {
			view: import("../../../shared/workspace-view").WorkspaceViewInput;
		}) => {
			snapshot = {
				...snapshot,
				...input.view,
				revision: snapshot.revision + 1,
			};
			return snapshot;
		},
		beginWorkspaceRestore: async () => {
			throw new Error("no automatic restore");
		},
		listPending: async () => [],
		rpc: async (r: { path: string; type: string }) => {
			if (r.type === "mutation") mutations.push(r.path);
			if (r.path === "workspace.list")
				return [
					{
						id: "workspace",
						name: "Local existing workspace",
						worktreePath: "/local/workspace",
					},
				];
			if (r.path === "terminal.list") return { sessions: [] };
			return [];
		},
	} as unknown as DirectWorkstationApi;
	const { container } = render(<Workstation api={api} />);
	fireEvent.click(await screen.findByRole("button", { name: "Connect" }));
	fireEvent.click(
		await screen.findByRole("button", { name: "Local existing workspace" }),
	);
	await waitFor(() =>
		expect(Boolean(container.querySelector(".ws-workspace-window"))).toBe(true),
	);
	expect(Boolean(container.querySelector(".ws-workspace-tabs"))).toBe(true);
	expect(snapshot.targets[0]?.workspaces[0]?.workspaceId).toBe("workspace");
	expect(mutations).toEqual([]);
});

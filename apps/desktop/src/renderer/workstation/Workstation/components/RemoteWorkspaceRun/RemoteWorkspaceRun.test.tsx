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
import { RemoteWorkspaceRun } from "./RemoteWorkspaceRun";
afterEach(cleanup);
const connection: DirectDescriptor = {
	connectionId: "remote",
	backendId: "backend",
	namespaceId: "namespace",
	instanceId: "instance",
	generation: 3,
	capabilities: { workstationWorkspaceRunV1: true, durableOperations: true },
};
const definition = {
	source: "project-config" as const,
	projectId: "project",
	commands: ["echo run"],
};
const base = {
	projectId: "project",
	definition,
	definitionVersion: "version",
	run: null,
};

test("a double click creates one durable run and attaches its returned execution", async () => {
	const calls: DirectRpc[] = [];
	let finish!: () => void;
	const attached: string[] = [];
	const api = {
		rpc: async (request: DirectRpc) => {
			calls.push(request);
			if (request.type === "query") return base;
			await new Promise<void>((resolve) => {
				finish = resolve;
			});
			return {
				workspaceId: "workspace",
				operationId: (request.input as { operationId: string }).operationId,
				terminalId: "terminal",
				executionId: "execution",
				state: "active",
				foregroundSeen: true,
				commands: ["echo run"],
				startedAt: 1,
			};
		},
	} as unknown as DirectWorkstationApi;
	render(
		<RemoteWorkspaceRun
			api={api}
			connection={connection}
			workspaceId="workspace"
			onConfigure={() => {}}
			onAttach={async (run) => {
				attached.push(run.executionId!);
			}}
		/>,
	);
	const button = await screen.findByRole("button", {
		name: "Run workspace command",
	});
	fireEvent.click(button);
	fireEvent.click(button);
	await waitFor(() =>
		expect(calls.filter((r) => r.type === "mutation")).toHaveLength(1),
	);
	await act(async () => finish());
	await waitFor(() => expect(attached).toEqual(["execution"]));
	expect(calls.find((r) => r.type === "mutation")).toMatchObject({
		connectionId: "remote",
		generation: 3,
		path: "workspaceRun.startV1",
		input: { workspaceId: "workspace", definitionVersion: "version" },
	});
});

test("remounting an existing run reads and attaches it without launching again", async () => {
	let mutations = 0;
	const attached: string[] = [];
	const run = {
		workspaceId: "workspace",
		operationId: "old-operation",
		terminalId: "old-terminal",
		executionId: "old-execution",
		state: "active",
		foregroundSeen: true,
		commands: ["echo run"],
		startedAt: 1,
	};
	const api = {
		rpc: async (request: DirectRpc) => {
			if (request.type === "mutation") mutations++;
			return { ...base, run };
		},
	} as unknown as DirectWorkstationApi;
	render(
		<RemoteWorkspaceRun
			api={api}
			connection={connection}
			workspaceId="workspace"
			onConfigure={() => {}}
			onAttach={async (value) => {
				attached.push(value.terminalId);
			}}
		/>,
	);
	await screen.findByRole("button", { name: "Stop workspace run command" });
	await waitFor(() => expect(attached).toEqual(["old-terminal"]));
	expect(mutations).toBe(0);
});

test("an older backend without run capability receives no run request", () => {
	let reads = 0;
	const api = {
		rpc: async () => {
			reads++;
			return base;
		},
	} as unknown as DirectWorkstationApi;
	render(
		<RemoteWorkspaceRun
			api={api}
			connection={{ ...connection, capabilities: { durableOperations: true } }}
			workspaceId="workspace"
			onConfigure={() => {}}
			onAttach={async () => {}}
		/>,
	);
	expect(screen.queryByRole("button")).toBeNull();
	expect(reads).toBe(0);
});

test("a lost start reply is read back without replay and requires journal reconciliation", async () => {
	let writes = 0,
		checks = 0;
	let current: unknown = base;
	const api = {
		rpc: async (request: DirectRpc) => {
			if (request.type === "query") return current;
			writes++;
			current = {
				...base,
				run: {
					workspaceId: "workspace",
					operationId: (request.input as { operationId: string }).operationId,
					terminalId: "terminal",
					executionId: "execution",
					state: "active",
					foregroundSeen: true,
					commands: ["echo run"],
					startedAt: 1,
				},
			};
			throw new Error(
				"Error invoking remote method 'direct-workstation': Error: Reply lost",
			);
		},
		reconcile: async () => {
			checks++;
			return [];
		},
		listPending: async () => [],
	} as unknown as DirectWorkstationApi;
	render(
		<RemoteWorkspaceRun
			api={api}
			connection={connection}
			workspaceId="workspace"
			onConfigure={() => {}}
			onAttach={async () => {}}
		/>,
	);
	fireEvent.click(
		await screen.findByRole("button", { name: "Run workspace command" }),
	);
	const stop = (await screen.findByRole("button", {
		name: "Stop workspace run command",
	})) as HTMLButtonElement;
	expect(stop.disabled).toBe(true);
	expect(screen.getByRole("alert").textContent).toBe("Reply lost");
	fireEvent.click(stop);
	expect(writes).toBe(1);
	fireEvent.click(screen.getByRole("button", { name: "Check pending action" }));
	await waitFor(() => expect(stop.disabled).toBe(false));
	expect(writes).toBe(1);
	expect(checks).toBe(1);
});

test("a launch reply from the previous backend cannot attach or unlock a new backend's launch", async () => {
	const finishes: ((value: unknown) => void)[] = [],
		attached: string[] = [];
	const api = {
		rpc: async (request: DirectRpc) =>
			request.type === "query"
				? base
				: new Promise((resolve) => {
						finishes.push(resolve);
					}),
	} as unknown as DirectWorkstationApi;
	const props = {
		api,
		workspaceId: "workspace",
		onConfigure: () => {},
		onAttach: async (run: { terminalId: string }) => {
			attached.push(run.terminalId);
		},
	};
	const view = render(
		<RemoteWorkspaceRun {...props} connection={connection} />,
	);
	fireEvent.click(
		await screen.findByRole("button", { name: "Run workspace command" }),
	);
	await waitFor(() => expect(finishes).toHaveLength(1));
	view.rerender(
		<RemoteWorkspaceRun
			{...props}
			connection={{
				...connection,
				connectionId: "other",
				namespaceId: "other",
				generation: 4,
			}}
		/>,
	);
	const next = (await screen.findByRole("button", {
		name: "Run workspace command",
	})) as HTMLButtonElement;
	fireEvent.click(next);
	await waitFor(() => expect(finishes).toHaveLength(2));
	const value = (terminalId: string) => ({
		workspaceId: "workspace",
		operationId: terminalId,
		terminalId,
		executionId: terminalId,
		state: "active",
		foregroundSeen: true,
		commands: ["echo run"],
		startedAt: 1,
	});
	await act(async () => finishes[0]?.(value("old")));
	expect(attached).toEqual([]);
	expect(next.disabled).toBe(true);
	await act(async () => finishes[1]?.(value("new")));
	expect(attached).toEqual(["new"]);
});

test("Run reads a just-saved definition before submitting its single start", async () => {
	let reads = 0;
	const writes: DirectRpc[] = [];
	const api = {
		rpc: async (request: DirectRpc) => {
			if (request.type === "query") {
				reads++;
				return {
					...base,
					definitionVersion: reads === 1 ? "old" : "just-saved",
				};
			}
			writes.push(request);
			return {
				workspaceId: "workspace",
				operationId: "operation",
				terminalId: "terminal",
				executionId: "execution",
				state: "active",
				foregroundSeen: true,
				commands: ["echo run"],
				startedAt: 1,
			};
		},
	} as unknown as DirectWorkstationApi;
	render(
		<RemoteWorkspaceRun
			api={api}
			connection={connection}
			workspaceId="workspace"
			onConfigure={() => {}}
			onAttach={async () => {}}
		/>,
	);
	fireEvent.click(
		await screen.findByRole("button", { name: "Run workspace command" }),
	);
	await waitFor(() => expect(writes).toHaveLength(1));
	expect(writes[0]?.input).toMatchObject({ definitionVersion: "just-saved" });
});

test("a run completed before its first reply still attaches its output without launching again", async () => {
	let mutations = 0;
	const attached: string[] = [];
	const run = {
		workspaceId: "workspace",
		operationId: "operation",
		terminalId: "terminal",
		executionId: "execution",
		commands: ["false"],
		startedAt: 1,
		state: "ended",
		foregroundSeen: false,
		completionTracked: true,
		exitCode: 17,
	};
	const api = {
		rpc: async (r: DirectRpc) => {
			if (r.type === "mutation") mutations++;
			return { ...base, run };
		},
	} as unknown as DirectWorkstationApi;
	render(
		<RemoteWorkspaceRun
			api={api}
			connection={connection}
			workspaceId="workspace"
			onConfigure={() => {}}
			onAttach={async (value) => {
				attached.push(value.executionId!);
			}}
		/>,
	);
	await screen.findByRole("button", { name: "Run workspace command" });
	await waitFor(() => expect(attached).toEqual(["execution"]));
	expect(screen.getByRole("status").textContent).toContain("17");
	expect(mutations).toBe(0);
});

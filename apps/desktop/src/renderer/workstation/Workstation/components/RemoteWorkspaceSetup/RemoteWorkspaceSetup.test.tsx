import { afterEach, expect, test } from "bun:test";
import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
} from "@testing-library/react";
import type {
	DirectDescriptor,
	DirectRpc,
	DirectWorkstationApi,
} from "../../../../../shared/direct-workstation";
import { RemoteWorkspaceSetup } from "./RemoteWorkspaceSetup";
afterEach(cleanup);
const connection: DirectDescriptor = {
	connectionId: "machine",
	backendId: "backend",
	namespaceId: "namespace",
	instanceId: "instance",
	generation: 1,
	capabilities: { workstationWorkspaceSetupV1: true },
};
test("a failed setup displays its exit status without creating or retrying a terminal", async () => {
	const calls: DirectRpc[] = [];
	const api = {
		rpc: async (r: DirectRpc) => {
			calls.push(r);
			return {
				workspaceId: "workspace",
				terminalId: "terminal",
				phase: "failed",
				exitCode: 17,
				completionTracked: true,
				startedAt: 1,
			};
		},
	} as unknown as DirectWorkstationApi;
	render(
		<RemoteWorkspaceSetup
			api={api}
			connection={connection}
			workspaceId="workspace"
		/>,
	);
	expect((await screen.findByRole("status")).textContent).toContain("17");
	expect(calls).toEqual([
		{
			connectionId: "machine",
			generation: 1,
			path: "workspaceSetup.getStateV1",
			type: "query",
			input: { workspaceId: "workspace" },
		},
	]);
});
test("known launch warnings are visible while an older backend receives no setup request", async () => {
	let calls = 0;
	const api = {
		rpc: async () => {
			calls++;
			return {
				workspaceId: "workspace",
				terminalId: "terminal",
				phase: "failed",
				warning: "Failed to start setup terminal: unavailable",
				startedAt: 1,
				completionTracked: true,
			};
		},
	} as unknown as DirectWorkstationApi;
	const v = render(
		<RemoteWorkspaceSetup
			api={api}
			connection={{ ...connection, capabilities: {} }}
			workspaceId="workspace"
		/>,
	);
	expect(calls).toBe(0);
	v.rerender(
		<RemoteWorkspaceSetup
			api={api}
			connection={connection}
			workspaceId="workspace"
		/>,
	);
	expect((await screen.findByRole("alert")).textContent).toContain(
		"unavailable",
	);
	expect(calls).toBe(1);
});
test("a late status from another workspace cannot overwrite the current setup", async () => {
	let finish!: (value: unknown) => void;
	const api = {
		rpc: async (r: DirectRpc) => {
			if ((r.input as { workspaceId: string }).workspaceId === "old")
				return new Promise<unknown>((resolve) => {
					finish = resolve;
				});
			return {
				workspaceId: "new",
				terminalId: "new-terminal",
				phase: "succeeded",
				exitCode: 0,
				startedAt: 1,
				completionTracked: true,
			};
		},
	} as unknown as DirectWorkstationApi;
	const v = render(
		<RemoteWorkspaceSetup
			api={api}
			connection={connection}
			workspaceId="old"
		/>,
	);
	v.rerender(
		<RemoteWorkspaceSetup
			api={api}
			connection={connection}
			workspaceId="new"
		/>,
	);
	expect((await screen.findByRole("status")).textContent).toContain(
		"Completed",
	);
	await act(async () => finish({ phase: "failed", exitCode: 17 }));
	expect(screen.getByRole("status").textContent).toContain("Completed");
	expect(screen.getByRole("status").textContent).not.toContain("17");
});

test("opening existing setup output never sends a host mutation and a view failure stays recoverable", async () => {
	const calls: DirectRpc[] = [];
	const value = {
		workspaceId: "workspace",
		terminalId: "existing-terminal",
		executionId: "existing-execution",
		phase: "failed",
		exitCode: 17,
		startedAt: 1,
		completionTracked: true,
	};
	const api = {
		rpc: async (r: DirectRpc) => {
			calls.push(r);
			return value;
		},
	} as unknown as DirectWorkstationApi;
	const opened: string[] = [];
	render(
		<RemoteWorkspaceSetup
			api={api}
			connection={connection}
			workspaceId="workspace"
			onOpen={async (setup) => {
				opened.push(setup.terminalId);
				throw new Error("View disconnected");
			}}
		/>,
	);
	fireEvent.click(await screen.findByRole("button", { name: "Show output" }));
	await screen.findByText("View disconnected");
	expect(opened).toEqual(["existing-terminal"]);
	expect(calls.every((r) => r.type === "query")).toBe(true);
	expect(screen.getByRole("status").textContent).toContain("17");
});

test("an already open workspace observes a later setup job through read-only polling", async () => {
	let reads = 0;
	const api = {
		rpc: async () =>
			++reads === 1
				? null
				: {
						workspaceId: "workspace",
						terminalId: "late-terminal",
						phase: "failed",
						exitCode: 17,
						startedAt: 1,
						completionTracked: true,
					},
	} as unknown as DirectWorkstationApi;
	render(
		<RemoteWorkspaceSetup
			api={api}
			connection={connection}
			workspaceId="workspace"
			pollMs={1}
		/>,
	);
	expect((await screen.findByRole("status")).textContent).toContain("17");
	expect(reads).toBeGreaterThanOrEqual(2);
});

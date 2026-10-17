import { afterEach, expect, test } from "bun:test";
import type { HostAgentConfig } from "@superset/host-service/settings";
import { TooltipProvider } from "@superset/ui/tooltip";
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
import { RemoteTerminalPresets } from "./RemoteTerminalPresets";

afterEach(cleanup);
const connection: DirectDescriptor = {
	connectionId: "ssh",
	backendId: "backend",
	namespaceId: "namespace",
	instanceId: "instance",
	generation: 3,
	capabilities: {
		durableOperations: true,
		terminals: true,
		workstationTerminalPresetsV1: true,
	},
};
const config: HostAgentConfig = {
	id: "configured-codex",
	presetId: "codex",
	label: "Remote Codex",
	command: "/opt/remote-codex",
	args: ["--approval-mode", "manual"],
	env: {},
	iconId: null,
	order: 0,
	promptTransport: "argv",
	promptArgs: [],
	resumeArgs: [],
	forkArgs: [],
};
test("the original default preset surface uses the selected host's config and launches only on an explicit click", async () => {
	const calls: DirectRpc[] = [],
		launched: unknown[] = [];
	const api = {
		rpc: async (r: DirectRpc) => {
			calls.push(r);
			return [config];
		},
	} as unknown as DirectWorkstationApi;
	render(
		<TooltipProvider>
			<RemoteTerminalPresets
				api={api}
				connection={connection}
				workspaceId="workspace"
				busy={false}
				onLaunch={(launch) => launched.push(launch)}
			/>
		</TooltipProvider>,
	);
	const button = await screen.findByRole("button", { name: "Remote Codex" });
	expect(calls).toEqual([
		{
			connectionId: "ssh",
			generation: 3,
			path: "settings.agentConfigs.list",
			type: "query",
			input: undefined,
		},
	]);
	expect(launched).toEqual([]);
	fireEvent.click(button);
	expect(launched).toEqual([
		{
			label: "Remote Codex",
			initialCommand: "/opt/remote-codex --approval-mode manual",
		},
	]);
});
test("older hosts receive no preset queries and late replies cannot populate a different backend", async () => {
	const calls: DirectRpc[] = [];
	let reply!: (value: HostAgentConfig[]) => void;
	const api = {
		rpc: async (r: DirectRpc) => {
			calls.push(r);
			return new Promise<HostAgentConfig[]>((r) => {
				reply = r;
			});
		},
	} as unknown as DirectWorkstationApi;
	const props = {
		api,
		connection: {
			...connection,
			capabilities: {
				...connection.capabilities,
				workstationTerminalPresetsV1: false,
			},
		},
		workspaceId: "workspace",
		busy: false,
		onLaunch: () => {
			throw new Error("automatic launch");
		},
	};
	const view = render(
		<TooltipProvider>
			<RemoteTerminalPresets {...props} />
		</TooltipProvider>,
	);
	expect(calls).toEqual([]);
	expect(
		screen
			.getByRole("button", { name: "Terminal Scripts" })
			.hasAttribute("disabled"),
	).toBe(true);
	view.rerender(
		<TooltipProvider>
			<RemoteTerminalPresets {...props} connection={connection} />
		</TooltipProvider>,
	);
	await waitFor(() => expect(calls).toHaveLength(1));
	view.rerender(
		<TooltipProvider>
			<RemoteTerminalPresets {...props} />
		</TooltipProvider>,
	);
	await act(async () => reply([config]));
	expect(screen.queryByRole("button", { name: "Remote Codex" })).toBeNull();
});

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

test("agent settings open the original launch form without launching a terminal", async () => {
	const calls: DirectRpc[] = [];
	const api = {
		rpc: async (r: DirectRpc) => {
			calls.push(r);
			return r.path === "settings.agentConfigs.list"
				? [config]
				: { config, revision: "a".repeat(64) };
		},
	} as unknown as DirectWorkstationApi;
	render(
		<TooltipProvider>
			<RemoteTerminalPresets
				api={api}
				connection={{
					...connection,
					capabilities: {
						...connection.capabilities,
						workstationAgentSettingsV1: true,
					},
				}}
				workspaceId="workspace"
				busy={false}
				onLaunch={() => {
					throw new Error("must not launch");
				}}
			/>
		</TooltipProvider>,
	);
	await screen.findByRole("button", { name: "Remote Codex" });
	fireEvent.click(screen.getByRole("button", { name: "Agent settings" }));
	await screen.findByRole("textbox", { name: "Command" });
	expect(calls.some((r) => r.type === "mutation")).toBe(false);
});

test("the host's custom configurations remain selectable beyond the first 128 entries", async () => {
	const agents = Array.from({ length: 129 }, (_, index) => ({
		...config,
		id: `custom-${index}`,
		presetId: "custom",
		label: `Configured agent ${index + 1}`,
	}));
	const api = { rpc: async () => agents } as unknown as DirectWorkstationApi;
	render(
		<TooltipProvider>
			<RemoteTerminalPresets
				api={api}
				connection={connection}
				workspaceId="workspace"
				busy={false}
				onLaunch={() => {}}
			/>
		</TooltipProvider>,
	);
	await waitFor(() =>
		expect(
			screen.getByRole("button", { name: "Agents" }).hasAttribute("disabled"),
		).toBe(false),
	);
	fireEvent.pointerDown(screen.getByRole("button", { name: "Agents" }), {
		button: 0,
		ctrlKey: false,
		pointerType: "mouse",
	});
	await screen.findByRole("menuitem", { name: "Configured agent 129" });
});

test("a deliberately empty versioned catalog remains manageable without the legacy reseeding list", async () => {
	const calls: DirectRpc[] = [];
	const api = {
		rpc: async (r: DirectRpc) => {
			calls.push(r);
			return r.path.endsWith("catalogWithRevisionV2")
				? { configs: [], revision: "a".repeat(64) }
				: [];
		},
	} as unknown as DirectWorkstationApi;
	render(
		<TooltipProvider>
			<RemoteTerminalPresets
				api={api}
				connection={{
					...connection,
					capabilities: {
						...connection.capabilities,
						workstationAgentSettingsV1: true,
						workstationAgentManagementV1: true,
						workstationAgentCatalogV2: true,
					},
				}}
				workspaceId="workspace"
				busy={false}
				onLaunch={() => {}}
			/>
		</TooltipProvider>,
	);
	await waitFor(() =>
		expect(
			(
				screen.getByRole("button", {
					name: "Agent settings",
				}) as HTMLButtonElement
			).disabled,
		).toBe(false),
	);
	expect(calls.map((c) => c.path)).toEqual([
		"settings.agentConfigs.catalogWithRevisionV2",
	]);
});

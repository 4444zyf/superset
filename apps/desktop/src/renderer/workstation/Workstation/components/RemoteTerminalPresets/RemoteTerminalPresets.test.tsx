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
	within,
} from "@testing-library/react";
import { DndProvider } from "react-dnd";
import { HTML5Backend } from "react-dnd-html5-backend";
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
test("editing an agent through its linked script refreshes the original launch bar without launching", async () => {
	let current = config;
	const calls: DirectRpc[] = [],
		launched: unknown[] = [];
	const preset = {
		id: "linked-script",
		name: "Linked workflow",
		agentId: config.id,
		cwd: "",
		commands: ["snapshot"],
		projectIds: null,
		tabOrder: 0,
		createdAt: new Date(0),
		executionMode: "new-tab",
	};
	const api = {
		rpc: async (r: DirectRpc) => {
			calls.push(r);
			if (r.path === "settings.agentConfigs.list") return [current];
			if (r.path === "settings.terminalPresets.catalogWithRevisionV1")
				return {
					initialized: true,
					presets: [preset],
					revision: "a".repeat(64),
				};
			if (r.path === "project.list") return [];
			if (r.path === "workspace.get")
				return { projectId: null, worktreePath: "/remote/worktree" };
			if (r.path === "settings.agentConfigs.getWithRevisionV1")
				return { config: current, revision: "b".repeat(64) };
			if (r.path === "settings.agentConfigs.updateWithRevisionV1") {
				current = {
					...current,
					...(r.input as { patch: Partial<HostAgentConfig> }).patch,
				};
				return { config: current, revision: "c".repeat(64) };
			}
			throw new Error("Unexpected request");
		},
	} as unknown as DirectWorkstationApi;
	const view = render(
		<DndProvider backend={HTML5Backend}>
			<TooltipProvider>
				<RemoteTerminalPresets
					api={api}
					connection={{
						...connection,
						capabilities: {
							...connection.capabilities,
							workstationTerminalScriptsV1: true,
							workstationTerminalScriptExecutionV1: true,
							workstationAgentSettingsV1: true,
						},
					}}
					workspaceId="workspace"
					busy={false}
					onLaunch={(launch) => launched.push(launch)}
					onLaunchScript={(launch) => launched.push(launch)}
				/>
			</TooltipProvider>
		</DndProvider>,
	);
	fireEvent.click(
		await screen.findByRole("button", { name: "Terminal Scripts" }),
	);
	fireEvent.click(
		within(screen.getByRole("dialog")).getByText("Linked workflow"),
	);
	fireEvent.click(screen.getByRole("button", { name: "Agent settings" }));
	const command = await screen.findByRole("textbox", { name: "Command" });
	fireEvent.change(command, {
		target: { value: "/updated/codex --approval-mode manual" },
	});
	fireEvent.blur(command);
	await waitFor(() =>
		expect(
			view.container
				.querySelector('[data-workstation-script-id="linked-script"] button')
				?.getAttribute("title"),
		).toContain("/updated/codex"),
	);
	expect(launched).toEqual([]);
	expect(calls.filter((c) => c.type === "mutation")).toHaveLength(1);
	expect(calls.find((c) => c.type === "mutation")).toMatchObject({
		connectionId: "ssh",
		generation: 3,
		path: "settings.agentConfigs.updateWithRevisionV1",
		input: { id: config.id, expectedRevision: "b".repeat(64) },
	});
});
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
	expect(Boolean(screen.queryByRole("button", { name: "Remote Codex" }))).toBe(
		false,
	);
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

test("the script bar uses the selected host catalog order, visibility and project scope", async () => {
	const rows = [
		{
			id: "11111111-1111-4111-8111-111111111111",
			name: "Build project",
			projectIds: ["project"],
			pinnedToBar: true,
		},
		{
			id: "22222222-2222-4222-8222-222222222222",
			name: "Hidden script",
			projectIds: null,
			pinnedToBar: false,
		},
		{
			id: "33333333-3333-4333-8333-333333333333",
			name: "Other project",
			projectIds: ["other"],
			pinnedToBar: true,
		},
		{
			id: "44444444-4444-4444-8444-444444444444",
			name: "Global script",
			projectIds: null,
			pinnedToBar: true,
		},
	].map((row, index) => ({
		...row,
		cwd: ".",
		commands: ["printf first", "printf second"],
		executionMode: "new-tab-split-pane" as const,
		tabOrder: index,
		createdAt: new Date(0),
	}));
	const launched: unknown[] = [];
	const api = {
		rpc: async (request: DirectRpc) => {
			if (request.path === "settings.agentConfigs.list") return [config];
			if (request.path === "settings.terminalPresets.catalogWithRevisionV1")
				return { initialized: true, revision: "a".repeat(64), presets: rows };
			if (request.path === "workspace.get")
				return {
					id: "workspace",
					projectId: "project",
					worktreePath: "/remote/project",
				};
			throw new Error("Unexpected procedure " + request.path);
		},
	} as unknown as DirectWorkstationApi;
	const view = render(
		<TooltipProvider>
			<RemoteTerminalPresets
				api={api}
				connection={{
					...connection,
					capabilities: {
						...connection.capabilities,
						workstationTerminalScriptsV1: true,
						workstationTerminalScriptExecutionV1: true,
					},
				}}
				workspaceId="workspace"
				busy={false}
				onLaunch={() => {
					throw new Error("Script must retain its launch mode");
				}}
				onLaunchScript={(preset) => launched.push(preset)}
			/>
		</TooltipProvider>,
	);
	const button = await screen.findByRole("button", { name: "Build project" });
	expect(
		[...view.container.querySelectorAll("[data-workstation-script-id]")].map(
			(e) => e.getAttribute("data-workstation-script-id"),
		),
	).toEqual([rows[0]?.id, rows[3]?.id]);
	expect(Boolean(screen.queryByRole("button", { name: "Remote Codex" }))).toBe(
		false,
	);
	expect(launched).toEqual([]);
	fireEvent.click(button);
	expect(launched).toEqual([rows[0]]);
});

test("an explicitly empty script catalog keeps the bar empty instead of recreating default agent buttons", async () => {
	let loaded = false;
	const api = {
		rpc: async (request: DirectRpc) => {
			if (request.path === "settings.agentConfigs.list") return [config];
			if (request.path === "settings.terminalPresets.catalogWithRevisionV1") {
				loaded = true;
				return { initialized: true, revision: "b".repeat(64), presets: [] };
			}
			if (request.path === "workspace.get")
				return {
					id: "workspace",
					projectId: "project",
					worktreePath: "/remote/project",
				};
			throw new Error("Unexpected procedure " + request.path);
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
						workstationTerminalScriptsV1: true,
					},
				}}
				workspaceId="workspace"
				busy={false}
				onLaunch={() => {
					throw new Error("No automatic launch");
				}}
			/>
		</TooltipProvider>,
	);
	await waitFor(() => expect(loaded).toBe(true));
	expect(Boolean(screen.queryByRole("button", { name: "Remote Codex" }))).toBe(
		false,
	);
	expect(screen.getByRole("button", { name: "Terminal Scripts" })).toBeTruthy();
});

test("hosts with script management but no execution capability cannot launch catalog scripts", async () => {
	const row = {
		id: "11111111-1111-4111-8111-111111111111",
		name: "Stored script",
		commands: ["printf once"],
		cwd: ".",
		projectIds: null,
		executionMode: "new-tab" as const,
		createdAt: new Date(0),
		tabOrder: 0,
	};
	let launches = 0;
	const api = {
		rpc: async (request: DirectRpc) =>
			request.path === "settings.agentConfigs.list"
				? [config]
				: request.path === "workspace.get"
					? {
							id: "workspace",
							projectId: "project",
							worktreePath: "/remote/project",
						}
					: { initialized: true, presets: [row], revision: "c".repeat(64) },
	} as unknown as DirectWorkstationApi;
	render(
		<TooltipProvider>
			<RemoteTerminalPresets
				api={api}
				connection={{
					...connection,
					capabilities: {
						...connection.capabilities,
						workstationTerminalScriptsV1: true,
					},
				}}
				workspaceId="workspace"
				busy={false}
				onLaunch={() => {}}
				onLaunchScript={() => {
					launches++;
				}}
			/>
		</TooltipProvider>,
	);
	const button = await screen.findByRole("button", { name: "Stored script" });
	expect(button.hasAttribute("disabled")).toBe(true);
	fireEvent.click(button);
	expect(launches).toBe(0);
});

import { afterEach, expect, test } from "bun:test";
import type {
	HostAgentConfig,
	HostTerminalPreset,
	HostTerminalPresetCatalog,
} from "@superset/host-service/settings";
import {
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
import {
	WorkstationEditorGuards,
	WorkstationEditorGuardsContext,
} from "../../providers/WorkstationEditorGuards/workstation-editor-guards";
import { RemoteTerminalScripts } from "./RemoteTerminalScripts";

afterEach(cleanup);
const row: HostTerminalPreset = {
	id: "e993c329-7315-40c7-8d56-cbcf155d6288",
	name: "Safe script",
	cwd: "",
	commands: ["printf safe"],
	projectIds: null,
	executionMode: "new-tab",
	tabOrder: 0,
	createdAt: new Date(0),
};
const connection: DirectDescriptor = {
	connectionId: "ssh",
	backendId: "b",
	namespaceId: "n",
	instanceId: "i",
	generation: 1,
	capabilities: { workstationTerminalScriptsV1: true },
};
function fixture({
	lostReply = false,
	conflict = false,
	initialized = true,
	linked = false,
	configurationRequest = undefined as
		| { requestId: string; presetId?: string }
		| undefined,
} = {}) {
	const agent: HostAgentConfig = {
		id: "linked-agent",
		presetId: "custom",
		label: "Linked agent",
		command: "/opt/linked",
		args: [],
		env: {},
		iconId: null,
		promptArgs: [],
		resumeArgs: [],
		forkArgs: [],
		promptTransport: "argv",
		order: 0,
	};
	const agentChanges: HostAgentConfig[] = [];
	let agentSnapshot = { config: agent, revision: "d".repeat(64) };
	let catalog: HostTerminalPresetCatalog = {
		initialized,
		presets: initialized
			? [{ ...row, ...(linked ? { agentId: agent.id } : {}) }]
			: [],
		revision: "a".repeat(64),
	};
	const calls: DirectRpc[] = [];
	const registry = new WorkstationEditorGuards();
	const api = {
		rpc: async (r: DirectRpc) => {
			calls.push(r);
			if (r.path === "settings.agentConfigs.getWithRevisionV1")
				return structuredClone(agentSnapshot);
			if (r.path === "settings.agentConfigs.updateWithRevisionV1") {
				const input = r.input as {
					id: string;
					expectedRevision: string;
					patch: Partial<HostAgentConfig>;
				};
				if (
					input.id !== agent.id ||
					input.expectedRevision !== agentSnapshot.revision
				)
					throw new Error("conflict");
				agentSnapshot = {
					config: { ...agentSnapshot.config, ...input.patch },
					revision: "e".repeat(64),
				};
				return structuredClone(agentSnapshot);
			}
			if (r.path === "project.list")
				return [
					{ id: "project-a", name: "Project A", repoPath: "/remote/repo" },
				];
			if (r.path === "workspace.get")
				return {
					id: "workspace",
					projectId: "project-a",
					worktreePath: "/remote/worktree",
				};
			if (r.path === "filesystem.browseHost") {
				const path = (r.input as { path?: string }).path ?? "/remote/worktree";
				return {
					path,
					parentPath: "/remote",
					entries: [{ name: "apps", isDirectory: true, isSymlink: false }],
				};
			}
			if (r.type === "query") return structuredClone(catalog);
			const { change, expectedRevision } = r.input as {
				change: {
					kind: string;
					preset: HostTerminalPreset;
					presets: HostTerminalPreset[];
					id: string;
					patch: Partial<HostTerminalPreset>;
					ids: string[];
				};
				expectedRevision: string;
			};
			if (conflict) {
				catalog = {
					...catalog,
					revision: "c".repeat(64),
					presets: [{ ...row, name: "Other client" }],
				};
				throw new Error("conflict");
			}
			if (expectedRevision !== catalog.revision) throw new Error("stale");
			if (change.kind === "initialize")
				catalog = {
					initialized: true,
					presets: change.presets,
					revision: "b".repeat(64),
				};
			if (change.kind === "add")
				catalog = {
					...catalog,
					presets: [...catalog.presets, change.preset],
					revision: "b".repeat(64),
				};
			if (change.kind === "update")
				catalog = {
					...catalog,
					presets: catalog.presets.map((p) =>
						p.id === change.id ? { ...p, ...change.patch } : p,
					),
					revision: "b".repeat(64),
				};
			if (change.kind === "remove")
				catalog = {
					...catalog,
					presets: catalog.presets.filter((p) => p.id !== change.id),
					revision: "b".repeat(64),
				};
			if (lostReply) throw new Error("response lost");
			return structuredClone(catalog);
		},
	} as unknown as DirectWorkstationApi;
	const props = {
		api,
		connection: linked
			? {
					...connection,
					capabilities: {
						...connection.capabilities,
						workstationAgentSettingsV1: true,
					},
				}
			: connection,
		agents: linked ? [agent] : [],
		onAgentChanged: (updated: HostAgentConfig) => agentChanges.push(updated),
		workspaceId: "workspace",
		busy: false,
		configurationRequest,
	};
	const view = render(
		<DndProvider backend={HTML5Backend}>
			<WorkstationEditorGuardsContext.Provider value={registry}>
				<RemoteTerminalScripts {...props} />
			</WorkstationEditorGuardsContext.Provider>
		</DndProvider>,
	);
	return { calls, registry, props, view, agentChanges, catalog: () => catalog };
}
test("a linked script opens the existing agent editor and preserves its unsaved script fields", async () => {
	const f = fixture({ linked: true });
	await openCatalog();
	fireEvent.click(await screen.findByText("Safe script"));
	const directory = await screen.findByLabelText("Directory");
	fireEvent.change(directory, { target: { value: "./unsent directory" } });
	fireEvent.click(screen.getByRole("button", { name: "Agent settings" }));
	await screen.findByDisplayValue("Linked agent");
	expect(f.calls.filter((c) => c.type === "mutation")).toEqual([]);
	expect(f.registry.getUnsaved()).toHaveLength(1);
	const label = screen.getByRole("textbox", { name: "Label" });
	fireEvent.change(label, { target: { value: "Updated linked agent" } });
	fireEvent.blur(label);
	await waitFor(() => expect(f.agentChanges).toHaveLength(1));
	expect(f.calls.find((c) => c.type === "mutation")).toMatchObject({
		connectionId: "ssh",
		generation: 1,
		path: "settings.agentConfigs.updateWithRevisionV1",
		input: { id: "linked-agent", expectedRevision: "d".repeat(64) },
	});
	fireEvent.click(
		within(screen.getByRole("dialog")).getByRole("button", {
			name: "Close",
		}),
	);
	await screen.findByDisplayValue("./unsent directory");
	expect(f.registry.getUnsaved()).toHaveLength(1);
	expect(
		f.calls.filter(
			(c) => c.path === "settings.terminalPresets.applyCatalogChangeV1",
		),
	).toEqual([]);
});
async function openCatalog() {
	const entry = await screen.findByRole("button", { name: "Terminal Scripts" });
	await waitFor(() => expect(entry.hasAttribute("disabled")).toBe(false));
	fireEvent.click(entry);
}
async function openEditor() {
	await openCatalog();
	fireEvent.click(await screen.findByText("Safe script"));
	return await screen.findByLabelText("Name");
}
test("Run configuration requests open the original selected script editor without writing or launching", async () => {
	const f = fixture({
		configurationRequest: { requestId: "run-edit", presetId: row.id },
	});
	const name = await screen.findByLabelText("Name");
	expect((name as HTMLInputElement).value).toBe(row.name);
	expect(f.calls.filter((r) => r.type === "mutation")).toEqual([]);
	expect(f.registry.getUnsaved()).toHaveLength(0);
});
test("a deleted Run script opens its existing list without recreating the script", async () => {
	const f = fixture({
		configurationRequest: { requestId: "deleted", presetId: "missing" },
	});
	await screen.findByText("Safe script");
	expect(screen.queryByLabelText("Name")).toBeNull();
	expect(f.calls.filter((r) => r.type === "mutation")).toEqual([]);
});
test("uses the original script editor and persists edits through the selected SSH catalog", async () => {
	const f = fixture();
	const name = await openEditor();
	fireEvent.change(name, { target: { value: "Edited 中文" } });
	expect(f.registry.getUnsaved()).toHaveLength(1);
	fireEvent.blur(name);
	await waitFor(() => expect(f.catalog().presets[0]?.name).toBe("Edited 中文"));
	await waitFor(() => expect(f.registry.getUnsaved()).toHaveLength(0));
	const writes = f.calls.filter((r) => r.type === "mutation");
	expect(writes).toHaveLength(1);
	expect(writes[0]).toMatchObject({
		connectionId: "ssh",
		generation: 1,
		path: "settings.terminalPresets.applyCatalogChangeV1",
		input: {
			expectedRevision: "a".repeat(64),
			change: { kind: "update", id: row.id, patch: { name: "Edited 中文" } },
		},
	});
	expect(screen.getByLabelText("Directory")).toBeTruthy();
	expect(screen.getByText("Launch mode")).toBeTruthy();
});
test("a lost save response is acknowledged only after matching readback and is never replayed", async () => {
	const f = fixture({ lostReply: true });
	const name = await openEditor();
	fireEvent.change(name, { target: { value: "Saved once" } });
	fireEvent.blur(name);
	await screen.findByText("Saved");
	expect(f.registry.getUnsaved()).toHaveLength(0);
	expect(f.calls.filter((r) => r.type === "mutation")).toHaveLength(1);
});
test("conflicts retain the draft and prevent Save All or repeated blur from overwriting another client", async () => {
	const f = fixture({ conflict: true });
	const name = await openEditor();
	fireEvent.change(name, { target: { value: "My draft" } });
	fireEvent.blur(name);
	await screen.findByText("This configuration changed. Reload before saving.");
	expect((name as HTMLInputElement).value).toBe("My draft");
	expect(f.catalog().presets[0]?.name).toBe("Other client");
	expect(await f.registry.getUnsaved()[0]?.save()).toBe(false);
	fireEvent.blur(name);
	expect(f.calls.filter((r) => r.type === "mutation")).toHaveLength(1);
	fireEvent.click(screen.getByRole("button", { name: "Reload" }));
	fireEvent.click(
		within(screen.getByRole("alertdialog")).getByRole("button", {
			name: "Cancel",
		}),
	);
	expect((name as HTMLInputElement).value).toBe("My draft");
});
test("initialization is explicit, happens once, and intentionally empty catalogs stay empty", async () => {
	const f = fixture({ initialized: false });
	await waitFor(() => expect(f.catalog().initialized).toBe(true));
	expect(f.calls.filter((r) => r.type === "mutation")).toHaveLength(1);
	fireEvent.click(screen.getByRole("button", { name: "Terminal Scripts" }));
	await screen.findByText(/No terminal scripts yet/);
	fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
	await waitFor(() =>
		expect(f.calls.filter((r) => r.type === "query").length).toBeGreaterThan(2),
	);
	expect(f.calls.filter((r) => r.type === "mutation")).toHaveLength(1);
});
test("unsupported hosts do not receive new terminal script procedures", async () => {
	const calls: DirectRpc[] = [];
	const api = {
		rpc: async (r: DirectRpc) => {
			calls.push(r);
		},
	} as unknown as DirectWorkstationApi;
	render(
		<RemoteTerminalScripts
			api={api}
			connection={{
				...connection,
				capabilities: { workstationTerminalScriptsV1: false },
			}}
			agents={[]}
			workspaceId="workspace"
			busy={false}
		/>,
	);
	expect(screen.queryByRole("button", { name: "Terminal Scripts" })).toBeNull();
	expect(calls).toHaveLength(0);
});

test("a failed initial catalog read leaves a visible management entry with an explicit retry", async () => {
	let reads = 0;
	const api = {
		rpc: async (r: DirectRpc) => {
			if (r.path.endsWith("catalogWithRevisionV1")) {
				if (++reads === 1) throw new Error("Storage temporarily unavailable");
				return { initialized: true, presets: [], revision: "a".repeat(64) };
			}
			if (r.path === "project.list") return [];
			return { projectId: "project-a" };
		},
	} as unknown as DirectWorkstationApi;
	render(
		<DndProvider backend={HTML5Backend}>
			<RemoteTerminalScripts
				api={api}
				connection={connection}
				workspaceId="workspace"
				agents={[]}
				busy={false}
			/>
		</DndProvider>,
	);
	await screen.findByText("Storage temporarily unavailable");
	const entry = screen.getByRole("button", { name: "Terminal Scripts" });
	expect((entry as HTMLButtonElement).disabled).toBe(false);
	fireEvent.click(entry);
	expect(
		(screen.getByRole("button", { name: "Add script" }) as HTMLButtonElement)
			.disabled,
	).toBe(true);
	fireEvent.click(await screen.findByRole("button", { name: "Refresh" }));
	await screen.findByText(/No terminal scripts yet/);
	expect(reads).toBe(2);
});

test("new scripts keep a stable ID, clear the last command, and delete only after confirmation", async () => {
	const f = fixture();
	fireEvent.click(
		await screen.findByRole("button", { name: "Terminal Scripts" }),
	);
	fireEvent.click(await screen.findByRole("button", { name: "Add script" }));
	const name = await screen.findByLabelText("Name");
	fireEvent.change(name, { target: { value: "My script" } });
	fireEvent.blur(name);
	await screen.findByText("Saved");
	const added = f.catalog().presets.find((p) => p.name === "My script");
	expect(Boolean(added?.id)).toBe(true);
	const command = screen.getByPlaceholderText("e.g. bun run dev");
	fireEvent.change(command, { target: { value: "printf once" } });
	fireEvent.blur(command);
	await waitFor(() =>
		expect(
			f.catalog().presets.find((p) => p.id === added?.id)?.commands,
		).toEqual(["printf once"]),
	);
	fireEvent.change(command, { target: { value: "" } });
	fireEvent.blur(command);
	await waitFor(() =>
		expect(
			f.catalog().presets.find((p) => p.id === added?.id)?.commands,
		).toEqual([""]),
	);
	fireEvent.click(screen.getByRole("button", { name: "Delete script" }));
	fireEvent.click(
		within(screen.getByRole("alertdialog")).getByRole("button", {
			name: "Cancel",
		}),
	);
	expect(f.catalog().presets).toHaveLength(2);
	fireEvent.click(screen.getByRole("button", { name: "Delete script" }));
	fireEvent.click(
		within(screen.getByRole("alertdialog")).getByRole("button", {
			name: "Delete script",
		}),
	);
	await waitFor(() => expect(f.catalog().presets).toHaveLength(1));
	expect(
		f.calls.filter(
			(r) => (r.input as { change?: { kind: string } })?.change?.kind === "add",
		),
	).toHaveLength(1);
});

test("directory browsing uses the SSH filesystem and stores the original workspace-relative value", async () => {
	const f = fixture();
	await openEditor();
	fireEvent.click(screen.getByRole("button", { name: "Browse for directory" }));
	const path = await screen.findByLabelText("Path");
	expect((path as HTMLInputElement).value).toBe("/remote/worktree");
	const directoryDialog = path.closest('[role="dialog"]');
	if (!directoryDialog) throw new Error("missing directory dialog");
	fireEvent.click(
		within(directoryDialog as HTMLElement).getByRole("button", {
			name: "apps",
		}),
	);
	await waitFor(() =>
		expect((screen.getByLabelText("Path") as HTMLInputElement).value).toBe(
			"/remote/worktree/apps",
		),
	);
	fireEvent.click(
		within(directoryDialog as HTMLElement).getByRole("button", {
			name: "Select folder",
		}),
	);
	await waitFor(() => expect(f.catalog().presets[0]?.cwd).toBe("./apps"));
	expect(
		f.calls
			.filter((r) => r.path === "filesystem.browseHost")
			.map((r) => ({ connectionId: r.connectionId, input: r.input })),
	).toEqual([
		{ connectionId: "ssh", input: { path: "/remote/worktree" } },
		{ connectionId: "ssh", input: { path: "/remote/worktree/apps" } },
	]);
});

test("closing a dirty original editor keeps the draft on Cancel and saves explicitly on Save & Continue", async () => {
	const f = fixture();
	const name = await openEditor();
	fireEvent.change(name, { target: { value: "Before close" } });
	fireEvent.click(screen.getByRole("button", { name: "Done" }));
	fireEvent.click(
		within(screen.getByRole("alertdialog")).getByRole("button", {
			name: "Cancel",
		}),
	);
	expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe(
		"Before close",
	);
	fireEvent.click(screen.getByRole("button", { name: "Done" }));
	fireEvent.click(
		within(screen.getByRole("alertdialog")).getByRole("button", {
			name: "Save & Continue",
		}),
	);
	await waitFor(() =>
		expect(screen.queryAllByLabelText("Name")).toHaveLength(0),
	);
	expect(f.catalog().presets[0]?.name).toBe("Before close");
	expect(f.registry.getUnsaved()).toHaveLength(0);
});

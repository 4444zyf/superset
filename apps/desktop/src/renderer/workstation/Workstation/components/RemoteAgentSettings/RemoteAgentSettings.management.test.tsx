import { afterEach, expect, test } from "bun:test";
import type { HostAgentConfig } from "@superset/host-service/settings";
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
	DirectDescriptor,
	DirectRpc,
	DirectWorkstationApi,
} from "../../../../../shared/direct-workstation";
import {
	WorkstationEditorGuards,
	WorkstationEditorGuardsContext,
} from "../../providers/WorkstationEditorGuards/workstation-editor-guards";
import { RemoteAgentSettings } from "./RemoteAgentSettings";

afterEach(cleanup);
const row: HostAgentConfig = {
	id: "builtin-id",
	presetId: "codex",
	iconId: null,
	label: "Configured Codex",
	command: "codex",
	args: [],
	env: {},
	promptTransport: "argv",
	promptArgs: [],
	resumeArgs: [],
	forkArgs: [],
	order: 0,
};
const connection: DirectDescriptor = {
	connectionId: "ssh",
	backendId: "backend",
	namespaceId: "namespace",
	instanceId: "i",
	generation: 1,
	capabilities: {
		workstationAgentSettingsV1: true,
		workstationAgentManagementV1: true,
	},
};
const second: HostAgentConfig = {
	...row,
	id: "second-agent",
	label: "Linked second agent",
	command: "/opt/second-agent",
};
function fixture(lostReply = false, initialAgentId?: string) {
	let catalog = {
		configs: initialAgentId === undefined ? [row] : [row, second],
		revision: "a".repeat(64),
	};
	const calls: DirectRpc[] = [];
	const api = {
		rpc: async (r: DirectRpc) => {
			calls.push(r);
			if (r.path.endsWith("catalogWithRevisionV1")) return catalog;
			if (r.path.endsWith("getWithRevisionV1")) {
				const config = catalog.configs.find(
					(c) => c.id === (r.input as { id: string }).id,
				);
				if (!config) throw new Error("Agent not found");
				return {
					config,
					revision: catalog.revision,
				};
			}
			const { change, expectedRevision } = r.input as {
				change: { kind: string; id: string; config: HostAgentConfig };
				expectedRevision: string;
			};
			if (expectedRevision !== catalog.revision) throw new Error("conflict");
			if (change.kind === "add")
				catalog = {
					configs: [
						...catalog.configs,
						{
							...change.config,
							id: change.id,
							order: 1,
							iconId: change.config.iconId ?? null,
						},
					],
					revision: "b".repeat(64),
				};
			if (change.kind === "remove")
				catalog = {
					configs: catalog.configs.filter((c) => c.id !== change.id),
					revision: "c".repeat(64),
				};
			if (lostReply && change.kind === "add") throw new Error("reply lost");
			return catalog;
		},
	} as unknown as DirectWorkstationApi;
	const registry = new WorkstationEditorGuards();
	render(
		<WorkstationEditorGuardsContext.Provider value={registry}>
			<RemoteAgentSettings
				api={api}
				connection={connection}
				agents={[row]}
				initialAgentId={initialAgentId}
				onChanged={() => {}}
				onClose={() => {}}
			/>
		</WorkstationEditorGuardsContext.Provider>,
	);
	return {
		calls,
		registry,
		external: () => {
			catalog = {
				configs: [{ ...row, label: "External config" }],
				revision: "b".repeat(64),
			};
		},
	};
}
test("an explicit linked-agent target opens its original editor instead of the first configured agent", async () => {
	const f = fixture(false, second.id);
	await screen.findByDisplayValue(second.label);
	expect(
		f.calls
			.filter((c) => c.path.endsWith("getWithRevisionV1"))
			.map((c) => c.input),
	).toEqual([{ id: second.id }]);
	expect(f.calls.filter((c) => c.type === "mutation")).toEqual([]);
});

test("a deleted explicit agent target never silently selects another agent", async () => {
	const f = fixture(false, "deleted-agent");
	await waitFor(() =>
		expect(f.calls.some((c) => c.path.endsWith("getWithRevisionV1"))).toBe(
			true,
		),
	);
	expect(
		f.calls
			.filter((c) => c.path.endsWith("getWithRevisionV1"))
			.every((c) => (c.input as { id: string }).id === "deleted-agent"),
	).toBe(true);
	await screen.findByText("Agent not found");
	expect(f.calls.filter((c) => c.type === "mutation")).toEqual([]);
});
test("original custom agent form creates a target config only after explicit submit", async () => {
	const f = fixture();
	const add = await screen.findByRole("button", { name: "Add agent" });
	fireEvent.pointerDown(add, { button: 0, ctrlKey: false });
	fireEvent.click(
		await screen.findByRole("menuitem", { name: "Custom agent…" }),
	);
	fireEvent.change(await screen.findByRole("textbox", { name: "Label" }), {
		target: { value: "My local agent" },
	});
	fireEvent.change(screen.getByRole("textbox", { name: "Command" }), {
		target: { value: "TEST='中文 🙂' /bin/sh -c 'echo probe'" },
	});
	expect(f.calls.filter((c) => c.type === "mutation")).toHaveLength(0);
	const form = screen.getByRole("textbox", { name: "Label" }).closest("form");
	if (!form) throw new Error("Missing original create form");
	fireEvent.click(within(form).getByRole("button", { name: "Add agent" }));
	await waitFor(() =>
		expect(f.calls.filter((c) => c.type === "mutation")).toHaveLength(1),
	);
	expect(f.calls.find((c) => c.type === "mutation")).toMatchObject({
		connectionId: "ssh",
		generation: 1,
		path: "settings.agentConfigs.applyCatalogChangeV1",
		input: {
			expectedRevision: "a".repeat(64),
			change: {
				kind: "add",
				config: {
					presetId: "custom",
					label: "My local agent",
					command: "/bin/sh",
					env: { TEST: "中文 🙂" },
				},
			},
		},
	});
	await screen.findByRole("button", { name: "My local agent" });
});
test("removing a reviewed agent requires the original confirmation and cancellation never mutates", async () => {
	const f = fixture();
	fireEvent.click(await screen.findByRole("button", { name: "Delete agent" }));
	let dialog = await screen.findByRole("alertdialog");
	fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
	expect(f.calls.filter((c) => c.type === "mutation")).toHaveLength(0);
	fireEvent.click(screen.getByRole("button", { name: "Delete agent" }));
	dialog = await screen.findByRole("alertdialog");
	fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));
	await waitFor(() =>
		expect(f.calls.filter((c) => c.type === "mutation")).toHaveLength(1),
	);
	expect(f.calls.find((c) => c.type === "mutation")).toMatchObject({
		input: {
			expectedRevision: "a".repeat(64),
			change: { kind: "remove", id: row.id },
		},
	});
});

async function openCustom() {
	fireEvent.pointerDown(
		await screen.findByRole("button", { name: "Add agent" }),
		{ button: 0, ctrlKey: false },
	);
	fireEvent.click(
		await screen.findByRole("menuitem", { name: "Custom agent…" }),
	);
	return await screen.findByRole("textbox", { name: "Label" });
}
test("a lost create reply is acknowledged by readonly stable ID without duplicating or retrying the mutation", async () => {
	const f = fixture(true);
	const label = await openCustom();
	fireEvent.change(label, { target: { value: "Recovered agent" } });
	fireEvent.change(screen.getByRole("textbox", { name: "Command" }), {
		target: { value: "/bin/sh" },
	});
	await waitFor(() => expect(f.registry.getUnsaved()).toHaveLength(1));
	const [guard] = f.registry.getUnsaved();
	if (!guard) throw new Error("Missing create draft guard");
	let result = false;
	await act(async () => {
		result = await guard.save();
	});
	expect(result).toBe(true);
	await screen.findByRole("button", { name: "Recovered agent" });
	expect(f.calls.filter((c) => c.type === "mutation")).toHaveLength(1);
	expect(f.registry.getUnsaved()).toHaveLength(0);
});
test("stale deletion stays in the confirmation and needs explicit refresh and review before another write", async () => {
	const f = fixture();
	fireEvent.click(await screen.findByRole("button", { name: "Delete agent" }));
	f.external();
	fireEvent.click(
		within(await screen.findByRole("alertdialog")).getByRole("button", {
			name: "Delete",
		}),
	);
	await within(await screen.findByRole("alertdialog")).findByText(
		"This configuration changed. Reload before saving.",
	);
	fireEvent.click(
		within(screen.getByRole("alertdialog")).getByRole("button", {
			name: "Delete",
		}),
	);
	expect(f.calls.filter((c) => c.type === "mutation")).toHaveLength(1);
	fireEvent.click(
		within(screen.getByRole("alertdialog")).getByRole("button", {
			name: "Cancel",
		}),
	);
	fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
	await screen.findByRole("button", { name: "External config" });
	fireEvent.click(await screen.findByRole("button", { name: "Delete agent" }));
	fireEvent.click(
		within(await screen.findByRole("alertdialog")).getByRole("button", {
			name: "Delete",
		}),
	);
	await waitFor(() =>
		expect(f.calls.filter((c) => c.type === "mutation")).toHaveLength(2),
	);
	expect(f.calls.filter((c) => c.type === "mutation").at(-1)).toMatchObject({
		input: { expectedRevision: "b".repeat(64) },
	});
});
test("an unsent custom form participates in close protection and cancelling navigation keeps its fields", async () => {
	const f = fixture();
	const label = await openCustom();
	fireEvent.change(label, { target: { value: "Unsent agent" } });
	await waitFor(() => expect(f.registry.getUnsaved()).toHaveLength(1));
	fireEvent.click(screen.getByRole("button", { name: "Configured Codex" }));
	fireEvent.click(
		within(await screen.findByRole("alertdialog")).getByRole("button", {
			name: "Cancel",
		}),
	);
	expect(
		(screen.getByRole("textbox", { name: "Label" }) as HTMLInputElement).value,
	).toBe("Unsent agent");
	expect(f.calls.filter((c) => c.type === "mutation")).toHaveLength(0);
});

test("explicitly discarding a new draft before refresh clears the form and its close guard", async () => {
	const f = fixture();
	const label = await openCustom();
	fireEvent.change(label, { target: { value: "Discard on refresh" } });
	fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
	fireEvent.click(
		within(await screen.findByRole("alertdialog")).getByRole("button", {
			name: "Discard changes",
		}),
	);
	await waitFor(() =>
		expect(
			(screen.getByRole("textbox", { name: "Label" }) as HTMLInputElement)
				.value,
		).toBe(""),
	);
	expect(f.registry.getUnsaved()).toHaveLength(0);
	expect(f.calls.filter((c) => c.type === "mutation")).toHaveLength(0);
});

test("an empty V2 target shows the original empty state and original Add menu", async () => {
	const calls: DirectRpc[] = [];
	const api = {
		rpc: async (r: DirectRpc) => {
			calls.push(r);
			return { configs: [], revision: "a".repeat(64) };
		},
	} as unknown as DirectWorkstationApi;
	render(
		<RemoteAgentSettings
			api={api}
			connection={{
				...connection,
				capabilities: {
					...connection.capabilities,
					workstationAgentCatalogV2: true,
				},
			}}
			agents={[]}
			onChanged={() => {}}
			onClose={() => {}}
		/>,
	);
	await screen.findByText("No agents yet");
	expect(
		(screen.getByRole("button", { name: "Add agent" }) as HTMLButtonElement)
			.disabled,
	).toBe(false);
	expect(calls.map((c) => c.path)).toEqual([
		"settings.agentConfigs.catalogWithRevisionV2",
	]);
});

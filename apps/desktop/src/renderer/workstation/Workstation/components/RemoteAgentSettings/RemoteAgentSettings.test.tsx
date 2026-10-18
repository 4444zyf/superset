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
import { RemoteAgentSettings } from "./RemoteAgentSettings";

afterEach(cleanup);
const config: HostAgentConfig = {
	id: "codex-id",
	presetId: "codex",
	iconId: null,
	label: "Remote Codex",
	command: "/opt/codex",
	args: ["--approval-mode", "manual"],
	env: { REMIX_TEST: "中文 space" },
	promptTransport: "argv",
	promptArgs: ["--"],
	resumeArgs: ["resume"],
	forkArgs: ["fork", "{sessionId}"],
	order: 0,
};
const connection: DirectDescriptor = {
	connectionId: "ssh",
	backendId: "backend",
	namespaceId: "namespace",
	instanceId: "instance",
	generation: 3,
	capabilities: { workstationAgentSettingsV1: true },
};
function fixture(conflict: boolean | "iconRejected" = false) {
	let snapshot = { config, revision: "a".repeat(64) };
	const calls: DirectRpc[] = [];
	const changed: HostAgentConfig[] = [];
	const api = {
		rpc: async (r: DirectRpc) => {
			calls.push(r);
			if (r.type === "query") return snapshot;
			if (conflict === "iconRejected") throw new Error("Icon rejected");
			if (conflict) {
				snapshot = {
					config: {
						...config,
						label: "External label",
						command: "/external/codex",
					},
					revision: "b".repeat(64),
				};
				throw new Error("Agent configuration changed");
			}
			snapshot = {
				config: {
					...snapshot.config,
					...(r.input as { patch: Partial<HostAgentConfig> }).patch,
				},
				revision: "b".repeat(64),
			};
			return snapshot;
		},
	} as unknown as DirectWorkstationApi;
	const props = {
		api,
		connection,
		agents: [config],
		onChanged: (row: HostAgentConfig) => changed.push(row),
		onClose: () => {},
	};
	render(<RemoteAgentSettings {...props} />);
	return { calls, changed, props };
}
test("original agent launch fields save a label to the selected host and keep permissions and prompt settings", async () => {
	const f = fixture();
	const label = await screen.findByRole("textbox", { name: "Label" });
	expect(
		(screen.getByRole("textbox", { name: "Command" }) as HTMLInputElement)
			.value,
	).toContain("--approval-mode manual");
	expect(f.calls.filter((r) => r.type === "mutation")).toEqual([]);
	fireEvent.change(label, { target: { value: "Renamed agent" } });
	fireEvent.blur(label);
	await waitFor(() => expect(f.changed).toHaveLength(1));
	expect(f.calls.find((r) => r.type === "mutation")).toMatchObject({
		connectionId: "ssh",
		generation: 3,
		path: "settings.agentConfigs.updateWithRevisionV1",
		input: {
			id: config.id,
			expectedRevision: "a".repeat(64),
			patch: {
				label: "Renamed agent",
				command: config.command,
				args: config.args,
				env: config.env,
				promptArgs: config.promptArgs,
				resumeArgs: config.resumeArgs,
				forkArgs: config.forkArgs,
				promptTransport: "argv",
			},
		},
	});
});
test("a conflicting edit keeps the original input until explicit confirmed reload", async () => {
	const f = fixture(true);
	const label = await screen.findByRole("textbox", { name: "Label" });
	fireEvent.change(label, { target: { value: "Unsent local label" } });
	fireEvent.blur(label);
	await screen.findByText("This configuration changed. Reload before saving.");
	expect(
		(screen.getByRole("textbox", { name: "Label" }) as HTMLInputElement).value,
	).toBe("Unsent local label");
	expect(f.calls.filter((r) => r.type === "mutation")).toHaveLength(1);
	fireEvent.click(screen.getByRole("button", { name: "Reload" }));
	fireEvent.click(
		within(await screen.findByRole("alertdialog")).getByRole("button", {
			name: "Cancel",
		}),
	);
	expect(
		(screen.getByRole("textbox", { name: "Label" }) as HTMLInputElement).value,
	).toBe("Unsent local label");
	fireEvent.click(screen.getByRole("button", { name: "Reload" }));
	await act(async () =>
		fireEvent.click(
			within(await screen.findByRole("alertdialog")).getByRole("button", {
				name: "Reload",
			}),
		),
	);
	await screen.findByDisplayValue("External label");
	expect(f.calls.filter((r) => r.type === "mutation")).toHaveLength(1);
	expect(f.changed).toEqual([]);
});

test("a replacement connection loads its own fields and ignores the previous save reply", async () => {
	let finish!: (value: unknown) => void;
	const changed: HostAgentConfig[] = [];
	let closed = 0;
	const api = {
		rpc: async (r: DirectRpc) =>
			r.type === "mutation"
				? new Promise((resolve) => {
						finish = resolve;
					})
				: {
						config: {
							...config,
							label:
								r.generation === 3 ? "Original scope" : "Replacement scope",
						},
						revision: (r.generation === 3 ? "a" : "b").repeat(64),
					},
	} as unknown as DirectWorkstationApi;
	const props = {
		api,
		connection,
		agents: [config],
		onChanged: (row: HostAgentConfig) => changed.push(row),
		onClose: () => {
			closed++;
		},
	};
	const view = render(<RemoteAgentSettings {...props} />);
	const label = await screen.findByRole("textbox", { name: "Label" });
	fireEvent.change(label, { target: { value: "Old pending save" } });
	fireEvent.blur(label);
	await waitFor(() => expect(typeof finish).toBe("function"));
	view.rerender(
		<RemoteAgentSettings
			{...props}
			connection={{ ...connection, generation: 4 }}
		/>,
	);
	await screen.findByDisplayValue("Replacement scope");
	await act(async () =>
		finish({
			config: { ...config, label: "Old pending save" },
			revision: "c".repeat(64),
		}),
	);
	expect(
		(screen.getByRole("textbox", { name: "Label" }) as HTMLInputElement).value,
	).toBe("Replacement scope");
	expect(changed).toEqual([]);
	fireEvent.click(screen.getByRole("button", { name: "Close" }));
	expect(closed).toBe(1);
});

test("a failed save while leaving the settings form stays visible in the original unsaved dialog", async () => {
	fixture(true);
	const label = await screen.findByRole("textbox", { name: "Label" });
	fireEvent.change(label, { target: { value: "Keep this label" } });
	fireEvent.click(screen.getByRole("button", { name: "Close" }));
	const dialog = await screen.findByRole("alertdialog");
	fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
	await within(dialog).findByText(
		"This configuration changed. Reload before saving.",
	);
	fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
	expect(
		(screen.getByRole("textbox", { name: "Label" }) as HTMLInputElement).value,
	).toBe("Keep this label");
});

test("returning a field to its saved value acknowledges without a host mutation", async () => {
	const f = fixture();
	const label = await screen.findByRole("textbox", { name: "Label" });
	fireEvent.change(label, { target: { value: "Temporary label" } });
	fireEvent.change(label, { target: { value: config.label } });
	fireEvent.blur(label);
	expect(Boolean(screen.queryByText("Saved"))).toBe(true);
	expect(f.calls.filter((r) => r.type === "mutation")).toHaveLength(0);
});

test("the original icon picker saves an existing agent icon without changing launch permissions", async () => {
	const f = fixture();
	await screen.findByRole("textbox", { name: "Label" });
	fireEvent.pointerDown(
		await screen.findByRole("button", { name: "No icon" }),
		{ button: 0, ctrlKey: false },
	);
	fireEvent.click(await screen.findByRole("menuitem", { name: "Gemini" }));
	await waitFor(() => expect(f.changed).toHaveLength(1));
	expect(f.calls.find((c) => c.type === "mutation")).toMatchObject({
		connectionId: "ssh",
		generation: 3,
		input: {
			expectedRevision: "a".repeat(64),
			patch: {
				iconId: "gemini",
				command: config.command,
				args: config.args,
				env: config.env,
			},
		},
	});
	expect(f.changed[0]?.iconId).toBe("gemini");
});
test("a conflicting icon save keeps the chosen icon and cannot acknowledge another stored icon", async () => {
	const f = fixture(true);
	await screen.findByRole("textbox", { name: "Label" });
	fireEvent.pointerDown(
		await screen.findByRole("button", { name: "No icon" }),
		{ button: 0, ctrlKey: false },
	);
	fireEvent.click(await screen.findByRole("menuitem", { name: "Gemini" }));
	await screen.findByText("This configuration changed. Reload before saving.");
	expect(Boolean(screen.queryByRole("button", { name: "Gemini" }))).toBe(true);
	expect(f.changed).toHaveLength(0);
	expect(f.calls.filter((c) => c.type === "mutation")).toHaveLength(1);
});

test("a rejected icon write cannot be acknowledged by an unchanged readonly row", async () => {
	const f = fixture("iconRejected");
	await screen.findByRole("textbox", { name: "Label" });
	fireEvent.pointerDown(
		await screen.findByRole("button", { name: "No icon" }),
		{ button: 0, ctrlKey: false },
	);
	fireEvent.click(await screen.findByRole("menuitem", { name: "Gemini" }));
	await screen.findByText("Icon rejected");
	expect(f.changed).toHaveLength(0);
	expect(Boolean(screen.queryByRole("button", { name: "Gemini" }))).toBe(true);
	expect(f.calls.filter((c) => c.type === "mutation")).toHaveLength(1);
});

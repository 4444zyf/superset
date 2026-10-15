import { afterEach, expect, test } from "bun:test";
import {
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
import { RemoteProjectSettings } from "./RemoteProjectSettings";

afterEach(cleanup);
const connection: DirectDescriptor = {
	connectionId: "remote",
	backendId: "backend",
	namespaceId: "namespace",
	instanceId: "instance",
	generation: 3,
	capabilities: { workstationProjectsV1: true },
};
const project = {
	id: "project",
	name: "Example",
	repoPath: "/remote/example",
	repoUrl: null,
	repoOwner: null,
	repoName: null,
	color: null,
	icon: null,
	worktreeBaseDir: null,
	branchPrefixMode: null,
	branchPrefixCustom: null,
	namingInstructions: null,
	sparseCheckoutPaths: [],
};

test.each([
	{
		label: "Naming instructions",
		path: "project.setNamingInstructions",
		field: "namingInstructions",
		first: "First rule",
		second: "Latest rule",
	},
	{
		label: "Sparse checkout",
		path: "project.setSparseCheckoutPaths",
		field: "sparseCheckoutPaths",
		first: "packages/one",
		second: "packages/two",
	},
])("$label saves while focused and preserves edits made during its request", async ({
	label,
	path,
	field,
	first,
	second,
}) => {
	const actual = { ...project };
	const writes: unknown[] = [];
	let finish!: () => void;
	const api = {
		rpc: async (request: DirectRpc) => {
			if (request.path === path) {
				const input = request.input as {
					instructions?: string;
					paths?: string[];
				};
				const value =
					path === "project.setNamingInstructions"
						? input.instructions
						: input.paths;
				writes.push(value);
				if (writes.length === 1)
					await new Promise<void>((resolve) => {
						finish = resolve;
					});
				Object.assign(actual, { [field]: value });
			}
			return { ...actual };
		},
	} as unknown as DirectWorkstationApi;
	render(
		<RemoteProjectSettings
			api={api}
			connection={connection}
			projectId="project"
			textDebounceMs={1}
			onClose={() => {}}
			onChanged={() => {}}
		/>,
	);
	const input = (await screen.findByLabelText(label)) as HTMLTextAreaElement;
	input.focus();
	fireEvent.change(input, { target: { value: first } });
	await waitFor(() => expect(writes).toHaveLength(1));
	expect(input.disabled || input.closest("fieldset")?.disabled).toBe(false);
	fireEvent.change(input, { target: { value: second } });
	fireEvent.blur(input);
	finish();
	await waitFor(() => expect(writes).toHaveLength(2));
	expect(writes[1]).toEqual(
		path === "project.setNamingInstructions" ? second : [second],
	);
	expect(input.value).toBe(second);
});

test("an old project write cannot install metadata after switching the target", async () => {
	let finish!: () => void;
	const calls: DirectRpc[] = [];
	let refreshed = 0;
	const api = {
		rpc: async (request: DirectRpc) => {
			calls.push(request);
			if (request.type === "mutation")
				await new Promise<void>((resolve) => {
					finish = resolve;
				});
			return (request.input as { projectId: string }).projectId === "second"
				? { ...project, id: "second", name: "Second" }
				: { ...project };
		},
	} as unknown as DirectWorkstationApi;
	const view = render(
		<RemoteProjectSettings
			api={api}
			connection={connection}
			projectId="project"
			onClose={() => {}}
			onChanged={() => {
				refreshed++;
			}}
		/>,
	);
	const input = await screen.findByLabelText("Name");
	fireEvent.change(input, { target: { value: "Old pending" } });
	fireEvent.blur(input);
	view.rerender(
		<RemoteProjectSettings
			api={api}
			connection={{
				...connection,
				connectionId: "other",
				backendId: "other",
				generation: 4,
			}}
			projectId="second"
			onClose={() => {}}
			onChanged={() => {
				refreshed++;
			}}
		/>,
	);
	await screen.findByRole("heading", { name: "Second" });
	finish();
	await Promise.resolve();
	await Promise.resolve();
	expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe(
		"Second",
	);
	expect(calls.filter((c) => c.type === "query")).toHaveLength(2);
	expect(refreshed).toBe(0);
});

test("project settings reuse original controls and write only the selected remote project", async () => {
	let actual = { ...project };
	const calls: DirectRpc[] = [];
	const api = {
		rpc: async (request: DirectRpc) => {
			calls.push(request);
			if (request.path === "project.update")
				actual = { ...actual, name: (request.input as { name: string }).name };
			return { ...actual };
		},
	} as unknown as DirectWorkstationApi;
	render(
		<RemoteProjectSettings
			api={api}
			connection={connection}
			projectId="project"
			onClose={() => {}}
			onChanged={() => {}}
		/>,
	);
	const input = await screen.findByLabelText("Name");
	fireEvent.change(input, { target: { value: "Renamed" } });
	fireEvent.blur(input);
	await waitFor(() =>
		expect(calls.filter((c) => c.type === "mutation")).toHaveLength(1),
	);
	expect(calls.find((c) => c.type === "mutation")).toMatchObject({
		connectionId: "remote",
		generation: 3,
		path: "project.update",
		input: { projectId: "project", name: "Renamed" },
	});
	await screen.findByRole("heading", { name: "Renamed" });
	expect(screen.getByText("~/Superset Remix/worktrees/")).toBeTruthy();
	expect(screen.getByText("/remote/example")).toBeTruthy();
});

test("a lost metadata reply is read back once and never replays the mutation", async () => {
	let actual = { ...project };
	let writes = 0;
	const api = {
		rpc: async (request: DirectRpc) => {
			if (request.type === "mutation") {
				writes++;
				actual = { ...actual, name: (request.input as { name: string }).name };
				throw new Error("Reply lost");
			}
			return { ...actual };
		},
	} as unknown as DirectWorkstationApi;
	render(
		<RemoteProjectSettings
			api={api}
			connection={connection}
			projectId="project"
			onClose={() => {}}
			onChanged={() => {}}
		/>,
	);
	const input = await screen.findByLabelText("Name");
	fireEvent.change(input, { target: { value: "Saved remotely" } });
	fireEvent.blur(input);
	await screen.findByRole("heading", { name: "Saved remotely" });
	fireEvent.blur(input);
	expect(writes).toBe(1);
});

test("an unconfirmed reply retains the field draft and blocks another blur write", async () => {
	let writes = 0;
	const api = {
		rpc: async (request: DirectRpc) => {
			if (request.type === "mutation") {
				writes++;
				throw new Error("Reply lost");
			}
			return { ...project };
		},
	} as unknown as DirectWorkstationApi;
	render(
		<RemoteProjectSettings
			api={api}
			connection={connection}
			projectId="project"
			onClose={() => {}}
			onChanged={() => {}}
		/>,
	);
	const input = (await screen.findByLabelText("Name")) as HTMLInputElement;
	fireEvent.change(input, { target: { value: "Keep my draft" } });
	fireEvent.blur(input);
	await screen.findByRole("alert");
	expect(input.value).toBe("Keep my draft");
	fireEvent.blur(input);
	expect(writes).toBe(1);
});

test("a write finishing after the dialog closes cannot refresh the current target", async () => {
	let finish!: () => void;
	let refreshes = 0;
	const calls: DirectRpc[] = [];
	const api = {
		rpc: async (request: DirectRpc) => {
			calls.push(request);
			if (request.type === "mutation")
				await new Promise<void>((resolve) => {
					finish = resolve;
				});
			return { ...project };
		},
	} as unknown as DirectWorkstationApi;
	const view = render(
		<RemoteProjectSettings
			api={api}
			connection={connection}
			projectId="project"
			onClose={() => {}}
			onChanged={() => {
				refreshes++;
			}}
		/>,
	);
	const input = await screen.findByLabelText("Name");
	fireEvent.change(input, { target: { value: "Late" } });
	fireEvent.blur(input);
	view.unmount();
	finish();
	await Promise.resolve();
	await Promise.resolve();
	expect(calls.filter((c) => c.type === "query")).toHaveLength(1);
	expect(refreshes).toBe(0);
});

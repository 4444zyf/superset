import { afterEach, expect, test } from "bun:test";
import {
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
} from "../../../../../../../shared/direct-workstation";
import { RemoteBaseBranch } from "./RemoteBaseBranch";

afterEach(cleanup);
const connection: DirectDescriptor = {
	connectionId: "machine",
	backendId: "backend",
	namespaceId: "namespace",
	generation: 2,
	instanceId: "instance",
	capabilities: { git: true, workstationGitV1: true },
};

test("original base selector updates only repository branch config and publishes the confirmed comparison", async () => {
	let base: string | null = null;
	const calls: DirectRpc[] = [];
	const selected: (string | undefined)[] = [];
	const api = {
		rpc: async (request: DirectRpc): Promise<unknown> => {
			calls.push(request);
			if (request.path === "git.listBranches")
				return {
					branches: [
						{ name: "main", isHead: true },
						{ name: "develop", isHead: false },
					],
				};
			if (request.path === "git.getBaseBranch") return { baseBranch: base };
			if (request.path === "git.getBranchSyncStatus")
				return { defaultBranch: "main", isDetached: false };
			if (request.path === "git.setBaseBranch") {
				base = (request.input as { baseBranch: string | null }).baseBranch;
				return { baseBranch: base };
			}
			throw new Error("Unexpected query");
		},
	} as unknown as DirectWorkstationApi;
	render(
		<RemoteBaseBranch
			api={api}
			connection={connection}
			workspaceId="workspace"
			onChange={(value) => {
				selected.push(value);
			}}
			onError={(message) => {
				throw new Error(message);
			}}
		/>,
	);
	fireEvent.click(await screen.findByRole("button", { name: "main" }));
	fireEvent.click(
		within(await screen.findByRole("dialog")).getByRole("button", {
			name: "develop",
		}),
	);
	await waitFor(() => expect(selected.at(-1)).toBe("develop"));
	expect(calls.filter((call) => call.type === "mutation")).toEqual([
		{
			connectionId: "machine",
			generation: 2,
			path: "git.setBaseBranch",
			type: "mutation",
			input: { workspaceId: "workspace", baseBranch: "develop" },
		},
	]);
	fireEvent.click(screen.getByRole("button", { name: "Auto" }));
	await waitFor(() => expect(selected.at(-1)).toBeUndefined());
	expect(
		calls.filter((call) => call.path === "git.setBaseBranch"),
	).toHaveLength(2);
});

test("a lost base configuration reply is checked by reading and never writes twice", async () => {
	let base: string | null = null;
	let writes = 0;
	const selected: (string | undefined)[] = [];
	const errors: string[] = [];
	const api = {
		rpc: async (request: DirectRpc): Promise<unknown> => {
			if (request.path === "git.listBranches")
				return {
					branches: [
						{ name: "main", isHead: true },
						{ name: "develop", isHead: false },
					],
				};
			if (request.path === "git.getBaseBranch") return { baseBranch: base };
			if (request.path === "git.getBranchSyncStatus")
				return { defaultBranch: "main", isDetached: false };
			writes++;
			base = (request.input as { baseBranch: string }).baseBranch;
			throw new Error("Reply lost");
		},
	} as unknown as DirectWorkstationApi;
	render(
		<RemoteBaseBranch
			api={api}
			connection={connection}
			workspaceId="workspace"
			onChange={(value) => selected.push(value)}
			onError={(message) => errors.push(message)}
		/>,
	);
	fireEvent.click(await screen.findByRole("button", { name: "main" }));
	fireEvent.click(
		within(await screen.findByRole("dialog")).getByRole("button", {
			name: "develop",
		}),
	);
	await waitFor(() => expect(selected.at(-1)).toBe("develop"));
	expect(writes).toBe(1);
	expect(errors).toEqual(["Reply lost"]);
});

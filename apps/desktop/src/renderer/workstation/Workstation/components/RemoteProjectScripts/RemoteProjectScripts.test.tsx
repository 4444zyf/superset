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
import { RemoteProjectScripts } from "./RemoteProjectScripts";
afterEach(cleanup);
const connection: DirectDescriptor = {
	connectionId: "remote",
	backendId: "backend",
	namespaceId: "namespace",
	instanceId: "instance",
	generation: 3,
	capabilities: { workstationProjectScriptsV1: true },
};
const empty = {
	content: null,
	revision: null,
	scripts: { setup: [], teardown: [], run: [] },
};

test("a lost script-save reply is confirmed once against the selected project's snapshot", async () => {
	let current: {
		content: string | null;
		revision: string | null;
		scripts: { setup: string[]; teardown: string[]; run: string[] };
	} = empty;
	const requests: DirectRpc[] = [];
	const api = {
		rpc: async (request: DirectRpc) => {
			requests.push(request);
			if (request.type === "mutation") {
				const { setup, teardown, run } = request.input as typeof empty.scripts;
				current = {
					content: JSON.stringify({ setup, teardown, run }),
					revision: "next",
					scripts: { setup, teardown, run },
				};
				throw new Error("Reply lost");
			}
			return current;
		},
	} as unknown as DirectWorkstationApi;
	render(
		<RemoteProjectScripts
			api={api}
			connection={connection}
			projectId="project"
			debounceMs={1}
		/>,
	);
	const input = await screen.findByRole("textbox");
	fireEvent.change(input, { target: { value: "echo setup" } });
	await screen.findByText("Saved");
	expect(requests.filter((r) => r.type === "mutation")).toHaveLength(1);
	expect(requests.find((r) => r.type === "mutation")).toMatchObject({
		connectionId: "remote",
		generation: 3,
		path: "config.setProjectScriptsV1",
		input: {
			projectId: "project",
			expectedRevision: null,
			setup: ["echo setup"],
			teardown: [],
			run: [],
		},
	});
	expect(requests.filter((r) => r.type === "query")).toHaveLength(2);
});

test("an unconfirmed script-save keeps its buffer and requires an explicit read before further writes", async () => {
	let writes = 0;
	const api = {
		rpc: async (request: DirectRpc) => {
			if (request.type === "mutation") {
				writes++;
				throw new Error("Reply lost");
			}
			return empty;
		},
	} as unknown as DirectWorkstationApi;
	render(
		<RemoteProjectScripts
			api={api}
			connection={connection}
			projectId="project"
			debounceMs={1}
		/>,
	);
	const input = (await screen.findByRole("textbox")) as HTMLTextAreaElement;
	fireEvent.change(input, { target: { value: "echo draft" } });
	await screen.findByText("Couldn't save");
	expect(input.value).toBe("echo draft");
	fireEvent.blur(input);
	expect(writes).toBe(1);
	fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
	await waitFor(() =>
		expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe(""),
	);
	expect(writes).toBe(1);
});

test("an older backend without script capability receives no script RPC", () => {
	let requests = 0;
	const api = {
		rpc: async () => {
			requests++;
			return empty;
		},
	} as unknown as DirectWorkstationApi;
	render(
		<RemoteProjectScripts
			api={api}
			connection={{
				...connection,
				capabilities: { workstationProjectsV1: true },
			}}
			projectId="project"
		/>,
	);
	expect(screen.queryByRole("textbox")).toBeNull();
	expect(requests).toBe(0);
});

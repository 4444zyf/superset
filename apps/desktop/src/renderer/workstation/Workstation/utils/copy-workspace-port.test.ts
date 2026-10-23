import { expect, test } from "bun:test";
import type {
	DirectDescriptor,
	DirectWorkstationApi,
} from "../../../../shared/direct-workstation";
import { copyWorkspacePort } from "./copy-workspace-port";

const connection: DirectDescriptor = {
	connectionId: "machine",
	backendId: "backend",
	namespaceId: "namespace",
	instanceId: "instance",
	generation: 1,
};
const forward = { id: "forward", url: "http://127.0.0.1:1000" };

test("copy retains a locally usable prepared address without using legacy browser opening", async () => {
	const calls: unknown[] = [];
	const api = {
		preparePort: async (...args: unknown[]) => {
			calls.push(args);
			return forward;
		},
		copyText: async (text: string) => {
			calls.push(text);
		},
		closePort: async () => {
			throw Error("retained forward closed");
		},
	};
	const result = await copyWorkspacePort({
		api,
		connection,
		workspaceId: "workspace",
		port: 3000,
		isCurrent: () => true,
	});
	expect(result).toEqual(forward);
	expect(calls).toEqual([[connection, "workspace", 3000], forward.url]);
});

test.each([
	"copyText",
	"preparePort",
] as const)("old APIs without %s do not start a copy forward", async (missing) => {
	const calls: string[] = [];
	const api = {
		preparePort: async () => {
			calls.push("prepare");
			return forward;
		},
		copyText: async () => {
			calls.push("copy");
		},
		closePort: async () => {
			calls.push("close");
		},
	};
	const legacy = { ...api, [missing]: undefined } as Pick<
		DirectWorkstationApi,
		"preparePort" | "copyText" | "closePort"
	>;
	expect(
		await copyWorkspacePort({
			api: legacy,
			connection,
			workspaceId: "workspace",
			port: 3000,
			isCurrent: () => true,
		}),
	).toBeNull();
	expect(calls).toEqual([]);
});

test("a prepared reply for a departed workspace closes the forward without writing the clipboard", async () => {
	let finish!: (value: typeof forward) => void;
	const prepared = new Promise<typeof forward>((resolve) => {
		finish = resolve;
	});
	const copied: string[] = [];
	const closed: string[] = [];
	let current = true;
	const result = copyWorkspacePort({
		api: {
			preparePort: async () => prepared,
			copyText: async (value) => {
				copied.push(value);
			},
			closePort: async (id) => {
				closed.push(id);
			},
		},
		connection,
		workspaceId: "workspace",
		port: 3000,
		isCurrent: () => current,
	});
	current = false;
	finish(forward);
	expect(await result).toBeNull();
	expect(copied).toEqual([]);
	expect(closed).toEqual([forward.id]);
});

test("clipboard failure releases the newly prepared forward", async () => {
	const closed: string[] = [];
	await expect(
		copyWorkspacePort({
			api: {
				preparePort: async () => forward,
				copyText: async () => {
					throw Error("Clipboard unavailable");
				},
				closePort: async (id) => {
					closed.push(id);
				},
			},
			connection,
			workspaceId: "workspace",
			port: 3000,
			isCurrent: () => true,
		}),
	).rejects.toThrow("Clipboard unavailable");
	expect(closed).toEqual([forward.id]);
});

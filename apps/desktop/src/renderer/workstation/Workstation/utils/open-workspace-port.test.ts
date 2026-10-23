import { expect, test } from "bun:test";
import type { DirectDescriptor } from "../../../../shared/direct-workstation";
import { openWorkspacePort } from "./open-workspace-port";

const connection: DirectDescriptor = {
	connectionId: "machine",
	generation: 1,
	backendId: "backend",
	namespaceId: "namespace",
	instanceId: "instance",
};

test("failed browser dispatch releases the prepared forward", async () => {
	const closed: string[] = [];
	await expect(
		openWorkspacePort({
			connection,
			workspaceId: "workspace",
			port: 3000,
			isCurrent: () => true,
			api: {
				preparePort: async () => ({
					id: "forward",
					url: "http://127.0.0.1:1000",
				}),
				openPort: async () => {
					throw new Error("Legacy opening was called");
				},
				closePort: async (id) => {
					closed.push(id);
				},
			},
			openExternal: async () => {
				throw new Error("Browser unavailable");
			},
		}),
	).rejects.toThrow("Browser unavailable");
	expect(closed).toEqual(["forward"]);
});

test("a scope lost during browser dispatch releases its forward", async () => {
	const closed: string[] = [];
	let current = true;
	const result = await openWorkspacePort({
		connection,
		workspaceId: "workspace",
		port: 3000,
		isCurrent: () => current,
		api: {
			preparePort: async () => ({
				id: "forward",
				url: "http://127.0.0.1:1000",
			}),
			openPort: async () => {
				throw new Error("Legacy opening was called");
			},
			closePort: async (id) => {
				closed.push(id);
			},
		},
		openExternal: async () => {
			current = false;
		},
	});
	expect(result).toBeNull();
	expect(closed).toEqual(["forward"]);
});

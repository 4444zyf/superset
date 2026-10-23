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

test("a forwarded terminal URL retains HTTPS, path, query and fragment", async () => {
	const opened: string[] = [];
	const result = await openWorkspacePort({
		connection,
		workspaceId: "workspace",
		port: 3000,
		isCurrent: () => true,
		targetUrl: "https://localhost:3000/preview/sub?q=%E4%B8%AD#fragment",
		api: {
			preparePort: async () => ({
				id: "forward",
				url: "http://127.0.0.1:1000",
			}),
			openPort: async () => {
				throw new Error("Legacy opening was called");
			},
			closePort: async () => {},
		},
		openExternal: async (url) => {
			opened.push(url);
		},
	});
	expect(opened).toEqual([
		"https://127.0.0.1:1000/preview/sub?q=%E4%B8%AD#fragment",
	]);
	expect(result).toEqual({ id: "forward", url: opened[0] });
});

test("an old API cannot open an incomplete forwarded URL", async () => {
	const calls: string[] = [];
	const result = await openWorkspacePort({
		connection,
		workspaceId: "workspace",
		port: 3000,
		isCurrent: () => true,
		targetUrl: "http://localhost:3000/a",
		api: {
			openPort: async () => {
				calls.push("legacy");
				return { id: "forward", url: "http://127.0.0.1:1000" };
			},
			closePort: async () => {
				calls.push("close");
			},
		},
		openExternal: async () => {
			calls.push("external");
		},
	});
	expect(result).toBeNull();
	expect(calls).toEqual([]);
});

test("a failed browser dispatch does not close a cached forward already in use", async () => {
	const closed: string[] = [];
	await expect(
		openWorkspacePort({
			connection,
			workspaceId: "workspace",
			port: 3000,
			isCurrent: () => true,
			existingForwardIds: new Set(["retained"]),
			api: {
				preparePort: async () => ({
					id: "retained",
					url: "http://127.0.0.1:1000",
				}),
				openPort: async () => {
					throw Error("legacy open");
				},
				closePort: async (id) => {
					closed.push(id);
				},
			},
			openExternal: async () => {
				throw Error("Browser unavailable");
			},
		}),
	).rejects.toThrow("Browser unavailable");
	expect(closed).toEqual([]);
});

import { expect, test } from "bun:test";
import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFsHostService } from "@superset/workspace-fs/host";
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { RemoteFiles } from "../../../renderer/workstation/Workstation/components/RemoteFiles/RemoteFiles";
import type {
	DirectDescriptor,
	DirectRpc,
	DirectWorkstationApi,
} from "../../../shared/direct-workstation";
import { WorkstationController } from "./workstation-controller";

test("the file editor saves host bytes and preserves a draft when another writer changes the file", async () => {
	const root = await realpath(await mkdtemp(join(tmpdir(), "direct-editor-")));
	const filePath = join(root, "note.txt");
	const service = createFsHostService({ rootPath: root });
	const errors: string[] = [];
	const mutations: unknown[] = [];
	const connection: DirectDescriptor = {
		connectionId: "mini",
		generation: 1,
		backendId: "backend",
		namespaceId: "namespace",
		instanceId: "instance",
		capabilities: { files: true },
	};
	const controller = new WorkstationController({
		getLease: () => ({ ...connection, url: "http://127.0.0.1:1" }),
		request: async () => {
			throw new Error("Unexpected HTTP request");
		},
		invoke: async (_id, request) => {
			if (request.type === "mutation") mutations.push(request);
			switch (request.path) {
				case "workspace.get":
					return { worktreePath: root };
				case "filesystem.listDirectory":
					return service.listDirectory(
						request.input as Parameters<typeof service.listDirectory>[0],
					);
				case "filesystem.readFile": {
					const result = await service.readFile(
						request.input as Parameters<typeof service.readFile>[0],
					);
					return result.kind === "bytes"
						? {
								...result,
								content: Buffer.from(result.content).toString("base64"),
							}
						: result;
				}
				case "filesystem.writeFile":
					return service.writeFile(
						request.input as Parameters<typeof service.writeFile>[0],
					);
				default:
					throw new Error(`Unexpected procedure ${request.path}`);
			}
		},
		disconnect: () => {},
		dispose: () => {},
	});
	const api = {
		rpc: (request: DirectRpc) => controller.invoke(request),
	} as unknown as DirectWorkstationApi;
	try {
		await writeFile(filePath, "before\n");
		render(
			<RemoteFiles
				api={api}
				connection={connection}
				workspaceId="workspace"
				onError={(error) => errors.push(error)}
			/>,
		);
		fireEvent.click(await screen.findByRole("button", { name: "note.txt" }));
		const editor = (await screen.findByLabelText(
			"File contents",
		)) as HTMLTextAreaElement;
		const save = screen.getByRole("button", {
			name: "Save file",
		}) as HTMLButtonElement;
		expect(save.disabled).toBe(true);
		fireEvent.change(editor, { target: { value: "saved on B\n" } });
		expect(save.disabled).toBe(false);
		fireEvent.click(save);
		await waitFor(async () =>
			expect(await readFile(filePath, "utf8")).toBe("saved on B\n"),
		);
		await waitFor(() => expect(save.disabled).toBe(true));
		expect(errors).toEqual([]);
		await writeFile(filePath, "another writer\n");
		fireEvent.change(editor, { target: { value: "preserve my draft\n" } });
		fireEvent.click(save);
		await waitFor(() => expect(errors).toHaveLength(1));
		expect(errors[0]).toContain("changed on the remote machine");
		expect(editor.value).toBe("preserve my draft\n");
		expect(await readFile(filePath, "utf8")).toBe("another writer\n");
		expect(mutations).toHaveLength(2);
	} finally {
		cleanup();
		await service.close();
		await rm(root, { recursive: true, force: true });
	}
});

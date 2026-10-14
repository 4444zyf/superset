import { afterEach, expect, test } from "bun:test";
import {
	act,
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
} from "../../../../../../../shared/direct-workstation";
import { FileOperationDialog } from "./FileOperationDialog";

afterEach(cleanup);
const connection: DirectDescriptor = {
	connectionId: "mini",
	generation: 3,
	backendId: "b",
	namespaceId: "n",
	instanceId: "i",
	capabilities: { workstationFilesV1: true },
};
function fixture(
	reply: (r: DirectRpc) => Promise<unknown> = async () => ({ ok: true }),
) {
	const calls: DirectRpc[] = [];
	const errors: string[] = [];
	const completed: string[] = [];
	return {
		calls,
		errors,
		completed,
		props: {
			api: {
				rpc: async (r: DirectRpc) => {
					calls.push(r);
					return reply(r);
				},
			} as DirectWorkstationApi,
			connection,
			workspaceId: "ws",
			root: "/repo",
			directory: "/repo/sub",
			onError: (message: string) => errors.push(message),
			onComplete: (path: string) => {
				completed.push(path);
			},
			onClose: () => {},
		},
	};
}

test("new files are created in the selected remote directory without overwriting existing files", async () => {
	const f = fixture();
	render(<FileOperationDialog {...f.props} operation={{ kind: "newFile" }} />);
	fireEvent.change(screen.getByLabelText("Name"), {
		target: { value: "hello.txt" },
	});
	fireEvent.click(screen.getByRole("button", { name: "Create" }));
	await waitFor(() => expect(f.completed).toEqual(["/repo/sub/hello.txt"]));
	expect(f.calls).toEqual([
		{
			connectionId: "mini",
			generation: 3,
			path: "filesystem.writeFile",
			type: "mutation",
			input: {
				workspaceId: "ws",
				absolutePath: "/repo/sub/hello.txt",
				content: "",
				options: { create: true, overwrite: false },
			},
		},
	]);
});

test("a destination outside the workspace is rejected before sending a move", async () => {
	const f = fixture();
	render(
		<FileOperationDialog
			{...f.props}
			operation={{ kind: "move", absolutePath: "/repo/sub/hello.txt" }}
		/>,
	);
	fireEvent.change(screen.getByLabelText("Path"), {
		target: { value: "../elsewhere/hello.txt" },
	});
	fireEvent.click(screen.getByRole("button", { name: "Move" }));
	await waitFor(() => expect(f.errors).toHaveLength(1));
	expect(f.calls).toEqual([]);
});

test("an existing destination keeps the name for correction and never retries with overwrite", async () => {
	const f = fixture(async () => ({ ok: false, reason: "exists" }));
	render(<FileOperationDialog {...f.props} operation={{ kind: "newFile" }} />);
	fireEvent.change(screen.getByLabelText("Name"), {
		target: { value: "existing.txt" },
	});
	fireEvent.click(screen.getByRole("button", { name: "Create" }));
	await waitFor(() => expect(f.errors).toHaveLength(1));
	expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe(
		"existing.txt",
	);
	expect(f.completed).toEqual([]);
	expect(f.calls).toHaveLength(1);
});

test("deleting requires explicit permanent-delete confirmation and includes the selected path", async () => {
	const f = fixture();
	render(
		<FileOperationDialog
			{...f.props}
			operation={{ kind: "delete", absolutePath: "/repo/sub/hello.txt" }}
		/>,
	);
	expect(f.calls).toEqual([]);
	fireEvent.click(screen.getByRole("button", { name: "Delete permanently" }));
	await waitFor(() => expect(f.completed).toHaveLength(1));
	expect(f.calls[0]).toMatchObject({
		path: "filesystem.deletePath",
		input: {
			workspaceId: "ws",
			absolutePath: "/repo/sub/hello.txt",
			permanent: true,
		},
	});
});

test("a late copy result cannot update the next workspace or copy twice", async () => {
	let finish!: (value: unknown) => void;
	const f = fixture(
		() =>
			new Promise((resolve) => {
				finish = resolve;
			}),
	);
	const view = render(
		<FileOperationDialog
			{...f.props}
			operation={{ kind: "copy", absolutePath: "/repo/sub/hello.txt" }}
		/>,
	);
	fireEvent.change(screen.getByLabelText("Path"), {
		target: { value: "new.txt" },
	});
	fireEvent.click(screen.getByRole("button", { name: "Copy" }));
	fireEvent.click(screen.getByRole("button", { name: "Copy" }));
	view.rerender(
		<FileOperationDialog
			{...f.props}
			workspaceId="next"
			operation={{ kind: "copy", absolutePath: "/repo/sub/hello.txt" }}
		/>,
	);
	await act(async () => finish({ ok: true }));
	expect(f.calls).toHaveLength(1);
	expect(f.completed).toEqual([]);
});

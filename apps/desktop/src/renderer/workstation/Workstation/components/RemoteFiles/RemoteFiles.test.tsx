import { afterEach, expect, test } from "bun:test";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
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
} from "../../../../../shared/direct-workstation";
import { RemoteFiles } from "./RemoteFiles";

afterEach(cleanup);
async function fileEditor() {
	const element = await screen.findByLabelText("File contents");
	await waitFor(() =>
		expect(element.querySelector(".cm-editor")).not.toBeNull(),
	);
	return element;
}
function contentOf(element: HTMLElement): string {
	const view = EditorView.findFromDOM(element.querySelector(".cm-editor")!);
	if (!view) throw new Error("Code editor did not mount");
	return view.state.doc.toString();
}
function replaceContent(element: HTMLElement, value: string) {
	const view = EditorView.findFromDOM(element.querySelector(".cm-editor")!);
	if (!view) throw new Error("Code editor did not mount");
	act(() =>
		view.dispatch({
			changes: { from: 0, to: view.state.doc.length, insert: value },
		}),
	);
}

const connection: DirectDescriptor = {
	connectionId: "mini",
	generation: 3,
	backendId: "b",
	namespaceId: "n",
	instanceId: "i",
	capabilities: { files: true, git: true },
};

test("a backend without Git capability can browse files without issuing Git requests", async () => {
	const f = fixture();
	render(
		<RemoteFiles
			api={f.api}
			connection={{ ...connection, capabilities: { files: true, git: false } }}
			workspaceId="workspace"
			onError={(error) => f.errors.push(error)}
		/>,
	);
	await screen.findByRole("button", { name: "note.txt" });
	expect(
		(screen.getByRole("button", { name: "Changes" }) as HTMLButtonElement)
			.disabled,
	).toBe(true);
	expect(f.calls.some((request) => request.path.startsWith("git."))).toBe(
		false,
	);
});
const status = {
	currentBranch: { name: "main" },
	staged: [],
	unstaged: [{ path: "note.txt", status: "modified" }],
	againstBase: [],
};
function fixture(
	overrides: Record<string, (request: DirectRpc) => unknown> = {},
) {
	const calls: DirectRpc[] = [];
	const errors: string[] = [];
	const api = {
		rpc: async (request: DirectRpc) => {
			calls.push(request);
			if (overrides[request.path]) return overrides[request.path]?.(request);
			switch (request.path) {
				case "workspace.get":
					return { worktreePath: "/Users/remote/repo" };
				case "filesystem.listDirectory":
					return {
						entries: [
							{
								absolutePath: "/Users/remote/repo/note.txt",
								name: "note.txt",
								kind: "file",
							},
						],
					};
				case "filesystem.readFile":
					return {
						kind: "bytes",
						content: btoa("remote contents"),
						exceededLimit: false,
						revision: "r1",
					};
				case "filesystem.writeFile":
					return { ok: true, revision: "r2" };
				case "git.getStatus":
					return status;
				case "git.getDiff":
					return {
						oldFile: { contents: "before" },
						newFile: { contents: "after" },
					};
				default:
					throw new Error(`Unexpected RPC ${request.path}`);
			}
		},
	} as DirectWorkstationApi;
	const onError = (message: string) => errors.push(message);
	return { api, calls, errors, onError };
}

test("reads and saves the remote file with an optimistic revision instead of local paths or storage", async () => {
	const { api, calls, onError } = fixture();
	const storageBefore = localStorage.length;
	render(
		<RemoteFiles
			api={api}
			connection={connection}
			workspaceId="workspace"
			onError={onError}
		/>,
	);
	fireEvent.click(await screen.findByRole("button", { name: "note.txt" }));
	const editor = await fileEditor();
	expect(contentOf(editor)).toBe("remote contents");
	replaceContent(editor, "updated from A");
	fireEvent.click(screen.getByRole("button", { name: "Save file" }));
	await waitFor(() =>
		expect(calls.some((call) => call.path === "filesystem.writeFile")).toBe(
			true,
		),
	);
	expect(
		calls.find((call) => call.path === "filesystem.writeFile"),
	).toMatchObject({
		connectionId: "mini",
		generation: 3,
		type: "mutation",
		input: {
			workspaceId: "workspace",
			absolutePath: "/Users/remote/repo/note.txt",
			content: "updated from A",
			precondition: { ifMatch: "r1" },
			options: { create: false, overwrite: true },
		},
	});
	expect(localStorage.length).toBe(storageBefore);
});

test("a concurrent remote edit preserves the user's draft without a blind retry", async () => {
	const { api, calls, errors, onError } = fixture({
		"filesystem.writeFile": () => ({
			ok: false,
			reason: "conflict",
			currentRevision: "someone-else",
		}),
	});
	render(
		<RemoteFiles
			api={api}
			connection={connection}
			workspaceId="workspace"
			onError={onError}
		/>,
	);
	fireEvent.click(await screen.findByRole("button", { name: "note.txt" }));
	const editor = await fileEditor();
	replaceContent(editor, "keep my draft");
	fireEvent.click(screen.getByRole("button", { name: "Save file" }));
	await waitFor(() => expect(errors).toHaveLength(1));
	expect(errors[0]).toContain("changed on the remote machine");
	expect(contentOf(editor)).toBe("keep my draft");
	expect(
		calls.filter((call) => call.path === "filesystem.writeFile"),
	).toHaveLength(1);
});

test("a truncated read cannot overwrite the complete remote file", async () => {
	const { api, calls, onError } = fixture({
		"filesystem.readFile": () => ({
			kind: "text",
			content: "prefix only",
			exceededLimit: true,
			revision: "r1",
		}),
	});
	render(
		<RemoteFiles
			api={api}
			connection={connection}
			workspaceId="workspace"
			onError={onError}
		/>,
	);
	fireEvent.click(await screen.findByRole("button", { name: "note.txt" }));
	const editor = await fileEditor();
	expect(
		EditorView.findFromDOM(editor.querySelector(".cm-editor")!)!.state.facet(
			EditorState.readOnly,
		),
	).toBe(true);
	expect(
		(screen.getByRole("button", { name: "Save file" }) as HTMLButtonElement)
			.disabled,
	).toBe(true);
	expect(
		calls.filter((call) => call.path === "filesystem.writeFile"),
	).toHaveLength(0);
});

test("invalid UTF-8 bytes cannot be saved through the text editor", async () => {
	const { api, calls, onError } = fixture({
		"filesystem.readFile": () => ({
			kind: "bytes",
			content: btoa(String.fromCharCode(255, 0)),
			exceededLimit: false,
			revision: "r1",
		}),
	});
	render(
		<RemoteFiles
			api={api}
			connection={connection}
			workspaceId="workspace"
			onError={onError}
		/>,
	);
	fireEvent.click(await screen.findByRole("button", { name: "note.txt" }));
	await screen.findByText("Binary files cannot be edited here.");
	expect(screen.queryByLabelText("File contents")).toBeNull();
	expect(
		calls.filter((call) => call.path === "filesystem.writeFile"),
	).toHaveLength(0);
});

test("editing a remote UTF-8 file retains its byte order mark", async () => {
	const { api, calls, onError } = fixture({
		"filesystem.readFile": () => ({
			kind: "bytes",
			content: "77u/aGVsbG8=",
			exceededLimit: false,
			revision: "r1",
		}),
	});
	render(
		<RemoteFiles
			api={api}
			connection={connection}
			workspaceId="workspace"
			onError={onError}
		/>,
	);
	fireEvent.click(await screen.findByRole("button", { name: "note.txt" }));
	const editor = (await fileEditor()) as HTMLElement;
	expect(contentOf(editor)).toBe("\uFEFFhello");
	replaceContent(editor, `${contentOf(editor)}!`);
	fireEvent.click(screen.getByRole("button", { name: "Save file" }));
	await waitFor(() =>
		expect(calls.some((call) => call.path === "filesystem.writeFile")).toBe(
			true,
		),
	);
	expect(
		calls.find((call) => call.path === "filesystem.writeFile")?.input,
	).toMatchObject({ content: "\uFEFFhello!" });
});

test("editing a remote CRLF file preserves its line endings", async () => {
	const { api, calls, onError } = fixture({
		"filesystem.readFile": () => ({
			kind: "text",
			content: "one\r\ntwo\r\n",
			exceededLimit: false,
			revision: "r1",
		}),
	});
	render(
		<RemoteFiles
			api={api}
			connection={connection}
			workspaceId="workspace"
			onError={onError}
		/>,
	);
	fireEvent.click(await screen.findByRole("button", { name: "note.txt" }));
	const editor = (await fileEditor()) as HTMLElement;
	replaceContent(editor, "one\ntwo changed\n");
	fireEvent.click(screen.getByRole("button", { name: "Save file" }));
	await waitFor(() =>
		expect(calls.some((call) => call.path === "filesystem.writeFile")).toBe(
			true,
		),
	);
	expect(
		calls.find((call) => call.path === "filesystem.writeFile")?.input,
	).toMatchObject({ content: "one\r\ntwo changed\r\n" });
});

test("Git diffs use the remote status category and surface transport failures", async () => {
	const { api, calls, errors, onError } = fixture({
		"git.getDiff": () => {
			throw new Error("SSH disconnected");
		},
	});
	render(
		<RemoteFiles
			api={api}
			connection={connection}
			workspaceId="workspace"
			onError={onError}
		/>,
	);
	fireEvent.click(await screen.findByRole("button", { name: "Changes" }));
	fireEvent.click(await screen.findByRole("button", { name: "note.txt" }));
	await waitFor(() => expect(errors).toHaveLength(1));
	expect(errors[0]).toBe("SSH disconnected");
	expect(calls.find((call) => call.path === "git.getDiff")).toMatchObject({
		type: "query",
		input: { workspaceId: "workspace", path: "note.txt", category: "unstaged" },
	});
});

test("a file read completing after the workspace changed cannot install an old editor", async () => {
	let completeRead: ((value: unknown) => void) | undefined;
	const { api, onError } = fixture({
		"filesystem.readFile": () =>
			new Promise((resolve) => {
				completeRead = resolve;
			}),
	});
	const view = render(
		<RemoteFiles
			api={api}
			connection={connection}
			workspaceId="old"
			onError={onError}
		/>,
	);
	fireEvent.click(await screen.findByRole("button", { name: "note.txt" }));
	await waitFor(() => expect(completeRead).toBeDefined());
	view.rerender(
		<RemoteFiles
			api={api}
			connection={{ ...connection, generation: 4 }}
			workspaceId="new"
			onError={onError}
		/>,
	);
	completeRead?.({
		kind: "text",
		content: "stale draft",
		exceededLimit: false,
		revision: "old-r",
	});
	await waitFor(() =>
		expect(screen.queryByLabelText("File contents")).toBeNull(),
	);
	expect(screen.queryByDisplayValue("stale draft")).toBeNull();
});

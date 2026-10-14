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

test("the original stage button stages a file and refreshes only the selected workspace", async () => {
	const f = fixture({ "git.stageFile": () => ({ success: true }) });
	render(
		<RemoteFiles
			api={f.api}
			connection={{
				...connection,
				capabilities: {
					files: true,
					git: true,
					workstationGitV1: true,
					durableOperations: true,
				},
			}}
			workspaceId="workspace"
			onError={f.onError}
		/>,
	);
	fireEvent.click(screen.getByRole("button", { name: "Changes" }));
	fireEvent.click(await screen.findByRole("button", { name: "Stage file" }));
	await waitFor(() =>
		expect(f.calls.some((call) => call.path === "git.stageFile")).toBe(true),
	);
	expect(f.calls.find((call) => call.path === "git.stageFile")).toMatchObject({
		connectionId: "mini",
		generation: 3,
		type: "mutation",
		input: { workspaceId: "workspace", filePath: "note.txt" },
	});
});

test("the original explorer action opens a create form using the current remote directory", async () => {
	const f = fixture();
	render(
		<RemoteFiles
			api={f.api}
			connection={{
				...connection,
				capabilities: { files: true, git: true, workstationFilesV1: true },
			}}
			workspaceId="workspace"
			onError={f.onError}
		/>,
	);
	await screen.findByRole("button", { name: "note.txt" });
	fireEvent.click(screen.getByRole("button", { name: "New File..." }));
	fireEvent.change(await screen.findByLabelText("Name"), {
		target: { value: "added.txt" },
	});
	fireEvent.click(screen.getByRole("button", { name: "Create" }));
	await waitFor(() =>
		expect(f.calls.some((call) => call.path === "filesystem.writeFile")).toBe(
			true,
		),
	);
	expect(
		f.calls.find((call) => call.path === "filesystem.writeFile"),
	).toMatchObject({
		input: {
			workspaceId: "workspace",
			absolutePath: "/Users/remote/repo/added.txt",
			content: "",
			options: { create: true, overwrite: false },
		},
	});
});

test("choosing Copy from the file menu leaves the destination dialog open", async () => {
	const f = fixture();
	render(
		<RemoteFiles
			api={f.api}
			connection={{
				...connection,
				capabilities: { files: true, git: true, workstationFilesV1: true },
			}}
			workspaceId="workspace"
			onError={f.onError}
		/>,
	);
	await screen.findByRole("button", { name: "note.txt" });
	const trigger = screen.getByRole("button", {
		name: "File actions: note.txt",
	});
	fireEvent.pointerDown(trigger, {
		button: 0,
		ctrlKey: false,
		pointerType: "mouse",
	});
	fireEvent.mouseDown(trigger, { button: 0, ctrlKey: false });
	const item = await screen.findByRole("menuitem", { name: "Copy" });
	fireEvent.pointerDown(item, { button: 0, pointerType: "mouse" });
	fireEvent.mouseDown(item, { button: 0 });
	fireEvent.mouseUp(item, { button: 0 });
	fireEvent.click(item);
	expect(screen.queryByRole("dialog") === null).toBe(true);
	expect(await screen.findByLabelText("Path")).not.toBeNull();
	expect(screen.getByRole("dialog")).not.toBeNull();
	expect(f.calls.some((call) => call.path === "filesystem.copyPath")).toBe(
		false,
	);
});

test("content search opens the selected remote file at the matched line", async () => {
	const f = fixture({
		"filesystem.searchContent": () => ({
			matches: [
				{
					absolutePath: "/Users/remote/repo/note.txt",
					relativePath: "note.txt",
					line: 3,
					column: 1,
					preview: "three",
				},
			],
		}),
		"filesystem.readFile": () => ({
			kind: "text",
			content: "one\ntwo\nthree\n",
			exceededLimit: false,
			revision: "r1",
		}),
	});
	render(
		<RemoteFiles
			api={f.api}
			connection={{
				...connection,
				capabilities: { files: true, git: true, workstationFilesV1: true },
			}}
			workspaceId="workspace"
			onError={f.onError}
		/>,
	);
	await screen.findByRole("button", { name: "note.txt" });
	fireEvent.click(screen.getByRole("button", { name: "Search files" }));
	fireEvent.click(screen.getByRole("button", { name: "Content" }));
	fireEvent.change(screen.getByLabelText("Search files"), {
		target: { value: "three" },
	});
	fireEvent.click(screen.getByRole("button", { name: "Search" }));
	fireEvent.click(await screen.findByRole("button", { name: /note.txt:3/ }));
	const element = await fileEditor();
	const view = EditorView.findFromDOM(element.querySelector(".cm-editor")!)!;
	await waitFor(() => expect(view.state.selection.main.head).toBe(8));
});

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

test("focus autosave reuses the remote file revision and saves once without manual Save", async () => {
	const { WorkstationPreferencesContext } = await import(
		"../../providers/WorkstationPreferencesContext"
	);
	const f = fixture();
	const values = {
		agentNativeInputEnabled: false,
		language: null,
		themeId: "dark",
		fontSettings: {},
		fileOpenMode: "split-pane" as const,
		fileAutoSave: "onFocusChange" as const,
		confirmOnQuit: true,
		terminalCopyOnSelect: false,
	};
	render(
		<WorkstationPreferencesContext
			value={{ revision: 1, invalid: false, values }}
		>
			<RemoteFiles
				api={f.api}
				connection={connection}
				workspaceId="workspace"
				onError={f.onError}
			/>
		</WorkstationPreferencesContext>,
	);
	fireEvent.click(await screen.findByRole("button", { name: "note.txt" }));
	const element = await fileEditor();
	replaceContent(element, "focus saved draft");
	fireEvent.blur(element, {
		relatedTarget: screen.getByRole("button", {
			name: "Refresh files and Git",
		}),
	});
	await waitFor(() =>
		expect(
			f.calls.filter((call) => call.path === "filesystem.writeFile"),
		).toHaveLength(1),
	);
	expect(
		f.calls.find((call) => call.path === "filesystem.writeFile")?.input,
	).toMatchObject({
		workspaceId: "workspace",
		absolutePath: "/Users/remote/repo/note.txt",
		content: "focus saved draft",
		precondition: { ifMatch: "r1" },
		options: { create: false, overwrite: true },
	});
	fireEvent.blur(element);
	await act(async () => {});
	expect(
		f.calls.filter((call) => call.path === "filesystem.writeFile"),
	).toHaveLength(1);
});

test("an autosave conflict preserves the draft and blocks further automatic writes", async () => {
	const { WorkstationPreferencesContext } = await import(
		"../../providers/WorkstationPreferencesContext"
	);
	const f = fixture({
		"filesystem.writeFile": () => ({ ok: false, reason: "conflict" }),
	});
	const values = {
		agentNativeInputEnabled: false,
		language: null,
		themeId: "dark",
		fontSettings: {},
		fileOpenMode: "split-pane" as const,
		fileAutoSave: "onWindowChange" as const,
		confirmOnQuit: true,
		terminalCopyOnSelect: false,
	};
	render(
		<WorkstationPreferencesContext
			value={{ revision: 1, invalid: false, values }}
		>
			<RemoteFiles
				api={f.api}
				connection={connection}
				workspaceId="workspace"
				onError={f.onError}
			/>
		</WorkstationPreferencesContext>,
	);
	fireEvent.click(await screen.findByRole("button", { name: "note.txt" }));
	const element = await fileEditor();
	replaceContent(element, "preserved draft");
	fireEvent.blur(window);
	await waitFor(() =>
		expect(
			f.calls.filter((call) => call.path === "filesystem.writeFile"),
		).toHaveLength(1),
	);
	await waitFor(() => expect(f.errors.length).toBe(1));
	replaceContent(element, "newer preserved draft");
	fireEvent.blur(window);
	await act(async () => {});
	expect(contentOf(element)).toBe("newer preserved draft");
	expect(
		f.calls.filter((call) => call.path === "filesystem.writeFile"),
	).toHaveLength(1);
});

test("a lost autosave reply does not retry the write on the next window blur", async () => {
	const { WorkstationPreferencesContext } = await import(
		"../../providers/WorkstationPreferencesContext"
	);
	let fail!: () => void;
	const f = fixture({
		"filesystem.writeFile": () =>
			new Promise((_resolve, reject) => {
				fail = () => reject(new Error("Reply lost"));
			}),
	});
	const values = {
		agentNativeInputEnabled: false,
		language: null,
		themeId: "dark",
		fontSettings: {},
		fileOpenMode: "split-pane" as const,
		fileAutoSave: "onWindowChange" as const,
		confirmOnQuit: true,
		terminalCopyOnSelect: false,
	};
	render(
		<WorkstationPreferencesContext
			value={{ revision: 1, invalid: false, values }}
		>
			<RemoteFiles
				api={f.api}
				connection={connection}
				workspaceId="workspace"
				onError={f.onError}
			/>
		</WorkstationPreferencesContext>,
	);
	fireEvent.click(await screen.findByRole("button", { name: "note.txt" }));
	const element = await fileEditor();
	replaceContent(element, "unknown saved draft");
	fireEvent.blur(window);
	await waitFor(() =>
		expect(
			f.calls.filter((call) => call.path === "filesystem.writeFile"),
		).toHaveLength(1),
	);
	await act(async () => {
		fail();
	});
	await waitFor(() => expect(f.errors).toContain("Reply lost"));
	replaceContent(element, "newer unknown draft");
	fireEvent.blur(window);
	await act(async () => {});
	expect(
		f.calls.filter((call) => call.path === "filesystem.writeFile"),
	).toHaveLength(1);
	expect(contentOf(element)).toBe("newer unknown draft");
});

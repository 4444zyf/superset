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
	within,
} from "@testing-library/react";
import type {
	DirectDescriptor,
	DirectRpc,
	DirectWorkstationApi,
} from "../../../../../shared/direct-workstation";
import { RemoteFiles } from "./RemoteFiles";

afterEach(cleanup);
async function treeRow(path: string) {
	let row: HTMLElement | null = null;
	await waitFor(() => {
		row =
			document
				.querySelector("file-tree-container")
				?.shadowRoot?.querySelector<HTMLElement>(
					`[data-item-path="${path}"]`,
				) ?? null;
		expect(row).not.toBeNull();
	});
	return row!;
}
function clickTreeRow(row: HTMLElement) {
	fireEvent.click(row, { composed: true });
}
async function fileEditor() {
	const element = await screen.findByRole("region", { name: "File contents" });
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
	await treeRow("note.txt");
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
	await treeRow("note.txt");
	fireEvent.contextMenu(await treeRow("note.txt"), {
		composed: true,
		button: 2,
	});
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
	await treeRow("note.txt");
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
	await treeRow("note.txt");
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
				case "git.listBranches":
					return { branches: [{ name: "main", isHead: true }] };
				case "git.getBaseBranch":
					return { baseBranch: null };
				case "git.getBranchSyncStatus":
					return { defaultBranch: "main", isDetached: false };
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
	clickTreeRow(await treeRow("note.txt"));
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
	clickTreeRow(await treeRow("note.txt"));
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
	clickTreeRow(await treeRow("note.txt"));
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
	clickTreeRow(await treeRow("note.txt"));
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
	clickTreeRow(await treeRow("note.txt"));
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
	clickTreeRow(await treeRow("note.txt"));
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
	clickTreeRow(await treeRow("note.txt"));
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
	clickTreeRow(await treeRow("note.txt"));
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
	clickTreeRow(await treeRow("note.txt"));
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
	clickTreeRow(await treeRow("note.txt"));
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

test("opening another file keeps both editable drafts and switching back does not re-read", async () => {
	const f = fixture({
		"filesystem.listDirectory": () => ({
			entries: [
				{
					absolutePath: "/Users/remote/repo/note.txt",
					name: "note.txt",
					kind: "file",
				},
				{
					absolutePath: "/Users/remote/repo/other.txt",
					name: "other.txt",
					kind: "file",
				},
			],
		}),
	});
	render(
		<RemoteFiles
			api={f.api}
			connection={connection}
			workspaceId="workspace"
			onError={f.onError}
		/>,
	);
	clickTreeRow(await treeRow("note.txt"));
	const firstEditor = await fileEditor();
	replaceContent(firstEditor, "first retained draft");
	clickTreeRow(await treeRow("other.txt"));
	await waitFor(() =>
		expect(
			screen
				.getByRole("tab", { name: /other.txt/ })
				.getAttribute("aria-selected"),
		).toBe("true"),
	);
	replaceContent(await fileEditor(), "second retained draft");
	fireEvent.click(screen.getByRole("tab", { name: /note.txt/ }));
	expect(contentOf(await fileEditor())).toBe("first retained draft");
	fireEvent.click(screen.getByRole("tab", { name: /other.txt/ }));
	expect(contentOf(await fileEditor())).toBe("second retained draft");
	expect(
		f.calls.filter((call) => call.path === "filesystem.readFile"),
	).toHaveLength(2);
});

test("closing a dirty file tab requires confirmation and Cancel keeps its draft", async () => {
	const f = fixture();
	render(
		<RemoteFiles
			api={f.api}
			connection={connection}
			workspaceId="workspace"
			onError={f.onError}
		/>,
	);
	clickTreeRow(await treeRow("note.txt"));
	const element = await fileEditor();
	replaceContent(element, "retained until confirmation");
	const tab = screen.getByRole("tab", { name: "note.txt" });
	fireEvent.click(within(tab).getByRole("button", { name: "Close tab" }));
	expect(await screen.findByRole("dialog")).not.toBeNull();
	fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
	expect(contentOf(await fileEditor())).toBe("retained until confirmation");
	fireEvent.click(within(tab).getByRole("button", { name: "Close tab" }));
	fireEvent.click(
		await screen.findByRole("button", { name: "Discard changes" }),
	);
	await waitFor(() =>
		expect(screen.queryByRole("tab", { name: "note.txt" })).toBeNull(),
	);
	expect(
		f.calls.filter((call) => call.path === "filesystem.writeFile"),
	).toHaveLength(0);
});

test("close all file tabs confirms all dirty drafts and closes them together", async () => {
	const f = fixture({
		"filesystem.listDirectory": () => ({
			entries: [
				{
					absolutePath: "/Users/remote/repo/note.txt",
					name: "note.txt",
					kind: "file",
				},
				{
					absolutePath: "/Users/remote/repo/other.txt",
					name: "other.txt",
					kind: "file",
				},
			],
		}),
	});
	render(
		<RemoteFiles
			api={f.api}
			connection={connection}
			workspaceId="workspace"
			onError={f.onError}
		/>,
	);
	clickTreeRow(await treeRow("note.txt"));
	replaceContent(await fileEditor(), "first draft");
	clickTreeRow(await treeRow("other.txt"));
	replaceContent(await fileEditor(), "second draft");
	fireEvent.contextMenu(screen.getByRole("tab", { name: "other.txt" }));
	fireEvent.click(await screen.findByRole("menuitem", { name: "Close All" }));
	expect((await screen.findByRole("dialog")).textContent).toContain("note.txt");
	expect(screen.getByRole("dialog").textContent).toContain("other.txt");
	fireEvent.click(screen.getByRole("button", { name: "Discard changes" }));
	await waitFor(() => expect(screen.queryAllByRole("tab")).toHaveLength(0));
});

test("a shared document provider retains the first workspace draft while another workspace is opened", async () => {
	const { WorkstationFileDocuments, WorkstationFileDocumentsContext } =
		await import("../../providers/WorkstationFileDocuments");
	const f = fixture();
	const manager = new WorkstationFileDocuments(f.api);
	const view = render(
		<WorkstationFileDocumentsContext value={manager}>
			<RemoteFiles
				api={f.api}
				connection={connection}
				workspaceId="first-workspace"
				onError={f.onError}
			/>
		</WorkstationFileDocumentsContext>,
	);
	clickTreeRow(await treeRow("note.txt"));
	replaceContent(await fileEditor(), "first workspace draft");
	view.rerender(
		<WorkstationFileDocumentsContext value={manager}>
			<RemoteFiles
				api={f.api}
				connection={connection}
				workspaceId="second-workspace"
				onError={f.onError}
			/>
		</WorkstationFileDocumentsContext>,
	);
	await waitFor(() =>
		expect(screen.queryByRole("region", { name: "File contents" })).toBeNull(),
	);
	clickTreeRow(await treeRow("note.txt"));
	expect(contentOf(await fileEditor())).toBe("remote contents");
	replaceContent(await fileEditor(), "second workspace draft");
	view.rerender(
		<WorkstationFileDocumentsContext value={manager}>
			<RemoteFiles
				api={f.api}
				connection={connection}
				workspaceId="first-workspace"
				onError={f.onError}
			/>
		</WorkstationFileDocumentsContext>,
	);
	expect(contentOf(await fileEditor())).toBe("first workspace draft");
	expect(
		f.calls.filter((call) => call.path === "filesystem.readFile"),
	).toHaveLength(2);
});

test("switching to Changes and back retains the original editor undo history", async () => {
	const { undo } = await import("@codemirror/commands");
	const f = fixture();
	render(
		<RemoteFiles
			api={f.api}
			connection={connection}
			workspaceId="workspace"
			onError={f.onError}
		/>,
	);
	clickTreeRow(await treeRow("note.txt"));
	const editor = await fileEditor();
	replaceContent(editor, "retained draft");
	fireEvent.click(screen.getByRole("button", { name: "Changes" }));
	fireEvent.click(screen.getByRole("button", { name: "Files" }));
	const current = EditorView.findFromDOM(
		(await fileEditor()).querySelector(".cm-editor")!,
	)!;
	act(() => {
		expect(undo(current)).toBe(true);
	});
	expect(contentOf(await fileEditor())).toBe("remote contents");
});

test("Git changes reuse the original split and unified diff controls without account providers", async () => {
	const { useSettings } = await import("renderer/stores/settings");
	const previous = useSettings.getState();
	const f = fixture();
	try {
		act(() => {
			useSettings.getState().update("diffStyle", "split");
			useSettings.getState().update("expandUnchanged", false);
		});
		render(
			<RemoteFiles
				api={f.api}
				connection={connection}
				workspaceId="workspace"
				onError={f.onError}
			/>,
		);
		fireEvent.click(screen.getByRole("button", { name: "Changes" }));
		fireEvent.click(await screen.findByRole("button", { name: "note.txt" }));
		fireEvent.click(
			await screen.findByRole("button", { name: "Unified view" }),
		);
		expect(useSettings.getState().diffStyle).toBe("unified");
		expect(
			screen
				.getByRole("button", { name: "Unified view" })
				.getAttribute("aria-pressed"),
		).toBe("true");
		fireEvent.click(screen.getByRole("button", { name: "Split view" }));
		expect(useSettings.getState().diffStyle).toBe("split");
		fireEvent.click(screen.getByRole("button", { name: "Show all lines" }));
		expect(useSettings.getState().expandUnchanged).toBe(true);
		fireEvent.click(
			screen.getByRole("button", { name: "Hide unchanged regions" }),
		);
		expect(useSettings.getState().expandUnchanged).toBe(false);
		fireEvent.click(screen.getByRole("button", { name: "Collapse all files" }));
		expect(
			screen.getByRole("button", { name: "Expand all files" }),
		).not.toBeNull();
		fireEvent.click(screen.getByRole("button", { name: "Expand all files" }));
		await waitFor(() =>
			expect(document.querySelector("diffs-container")).not.toBeNull(),
		);
		await waitFor(() => {
			const root = document.querySelector("diffs-container")?.shadowRoot;
			expect(
				root
					?.querySelector('[data-line][data-line-type="change-deletion"]')
					?.textContent?.trim(),
			).toBe("before");
			expect(
				root
					?.querySelector('[data-line][data-line-type="change-addition"]')
					?.textContent?.trim(),
			).toBe("after");
		});

		expect(f.calls.filter((call) => call.path === "git.getDiff")).toHaveLength(
			1,
		);
	} finally {
		act(() => {
			useSettings.getState().update("diffStyle", previous.diffStyle);
			useSettings
				.getState()
				.update("expandUnchanged", previous.expandUnchanged);
		});
	}
});

test("history opens the selected commit files and requests that commit's original diff", async () => {
	const hash = "a".repeat(40);
	const f = fixture({
		"git.listRepositoryCommitsV1": () => ({
			head: hash,
			commits: [
				{
					hash,
					shortHash: "aaaaaaa",
					message: "Selected history commit",
					author: "History Author",
					authorEmail: "history@example.invalid",
					date: "2026-10-14T00:00:00Z",
				},
			],
			nextCursor: null,
		}),
		"git.getCommitFiles": () => ({
			files: [{ path: "note.txt", status: "modified" }],
		}),
	});
	render(
		<RemoteFiles
			api={f.api}
			connection={{
				...connection,
				capabilities: {
					git: true,
					files: true,
					workstationGitV1: true,
					workstationGitHistoryV1: true,
				},
			}}
			workspaceId="workspace"
			onError={f.onError}
		/>,
	);
	fireEvent.click(screen.getByRole("button", { name: "History" }));
	fireEvent.click(
		await screen.findByRole("button", { name: /Selected history commit/ }),
	);
	fireEvent.click(await screen.findByRole("button", { name: "note.txt" }));
	await waitFor(() =>
		expect(f.calls.find((call) => call.path === "git.getDiff")).toMatchObject({
			input: {
				workspaceId: "workspace",
				category: "commit",
				commitHash: hash,
				path: "note.txt",
			},
		}),
	);
	expect(
		f.calls.find((call) => call.path === "git.getCommitFiles"),
	).toMatchObject({ input: { workspaceId: "workspace", commitHash: hash } });
	expect(f.calls.some((call) => call.type === "mutation")).toBe(false);
});

test("the configured base branch reaches status and against-base diff queries", async () => {
	let base: string | null = null;
	const f = fixture({
		"git.listBranches": () => ({
			branches: [
				{ name: "main", isHead: true },
				{ name: "develop", isHead: false },
			],
		}),
		"git.getBaseBranch": () => ({ baseBranch: base }),
		"git.getBranchSyncStatus": () => ({
			defaultBranch: "main",
			isDetached: false,
		}),
		"git.setBaseBranch": (request) => {
			base = (request.input as { baseBranch: string }).baseBranch;
			return { baseBranch: base };
		},
		"git.getStatus": () => ({
			...status,
			againstBase: [{ path: "note.txt", status: "modified" }],
		}),
	});
	render(
		<RemoteFiles
			api={f.api}
			connection={{
				...connection,
				capabilities: { git: true, files: true, workstationGitV1: true },
			}}
			workspaceId="workspace"
			onError={f.onError}
		/>,
	);
	fireEvent.click(screen.getByRole("button", { name: "Changes" }));
	fireEvent.click(await screen.findByRole("button", { name: "main" }));
	fireEvent.click(
		within(await screen.findByRole("dialog")).getByRole("button", {
			name: "develop",
		}),
	);
	await waitFor(() =>
		expect(
			f.calls.find(
				(call) =>
					call.path === "git.getStatus" &&
					(call.input as { baseBranch?: string }).baseBranch === "develop",
			),
		).toBeDefined(),
	);
	fireEvent.click(screen.getByRole("button", { name: "Against base" }));
	fireEvent.click(await screen.findByRole("button", { name: "note.txt" }));
	await waitFor(() =>
		expect(f.calls.find((call) => call.path === "git.getDiff")).toMatchObject({
			input: {
				workspaceId: "workspace",
				category: "against-base",
				baseBranch: "develop",
				path: "note.txt",
			},
		}),
	);
});

test("a late configured base invalidates an in-flight default-base diff and refreshes comparison status", async () => {
	let finishBase!: (value: unknown) => void;
	let finishDiff!: (value: unknown) => void;
	const f = fixture({
		"git.getBaseBranch": () =>
			new Promise<unknown>((resolve) => {
				finishBase = resolve;
			}),
		"git.getStatus": () => ({
			...status,
			againstBase: [{ path: "note.txt", status: "modified" }],
		}),
		"git.getDiff": () =>
			new Promise<unknown>((resolve) => {
				finishDiff = resolve;
			}),
	});
	render(
		<RemoteFiles
			api={f.api}
			connection={{
				...connection,
				capabilities: { git: true, files: true, workstationGitV1: true },
			}}
			workspaceId="workspace"
			onError={f.onError}
		/>,
	);
	fireEvent.click(screen.getByRole("button", { name: "Changes" }));
	await waitFor(() =>
		expect(
			(
				screen.getByRole("button", {
					name: "Against base",
				}) as HTMLButtonElement
			).disabled,
		).toBe(false),
	);
	fireEvent.click(screen.getByRole("button", { name: "Against base" }));
	fireEvent.click(await screen.findByRole("button", { name: "note.txt" }));
	await waitFor(() => expect(finishDiff).toBeDefined());
	await act(async () => finishBase({ baseBranch: "develop" }));
	await act(async () =>
		finishDiff({
			oldFile: { contents: "outdated base" },
			newFile: { contents: "new" },
		}),
	);
	await waitFor(() =>
		expect(
			f.calls.some(
				(call) =>
					call.path === "git.getStatus" &&
					(call.input as { baseBranch?: string }).baseBranch === "develop",
			),
		).toBe(true),
	);
	expect(document.querySelector("[data-remote-git-diff]")).toBeNull();
});

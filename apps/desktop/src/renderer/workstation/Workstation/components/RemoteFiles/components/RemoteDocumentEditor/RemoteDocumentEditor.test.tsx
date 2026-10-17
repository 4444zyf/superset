import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { setupI18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import {
	act,
	render as baseRender,
	cleanup,
	fireEvent,
	screen,
	waitFor,
} from "@testing-library/react";
import type { Editor } from "@tiptap/core";
import type { ReactElement } from "react";
import type {
	ContentState,
	SharedFileDocument,
} from "renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/state/fileDocumentStore/types";
import { WorkstationFileDocuments } from "renderer/workstation/Workstation/providers/WorkstationFileDocuments/workstation-file-documents";
import type {
	DirectDescriptor,
	DirectRpc,
	DirectWorkstationApi,
} from "shared/direct-workstation";
import { RemoteDocumentEditor } from "./RemoteDocumentEditor";

const messages = setupI18n({ locale: "en", messages: { en: {} } });
function render(ui: ReactElement) {
	return baseRender(ui, {
		wrapper: ({ children }) => (
			<I18nProvider i18n={messages}>{children}</I18nProvider>
		),
	});
}

const browserSettings = (
	window as unknown as {
		happyDOM: { settings: { disableIframePageLoading: boolean } };
	}
).happyDOM.settings;
let priorIframeLoading = false;
let sequence = 0;
let createUrl: ReturnType<typeof spyOn<typeof URL, "createObjectURL">>;
let revokeUrl: ReturnType<typeof spyOn<typeof URL, "revokeObjectURL">>;
beforeEach(() => {
	priorIframeLoading = browserSettings.disableIframePageLoading;
	browserSettings.disableIframePageLoading = true;
	createUrl = spyOn(URL, "createObjectURL").mockImplementation(
		() => `blob:preview-${++sequence}`,
	);
	revokeUrl = spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
});
afterEach(() => {
	cleanup();
	createUrl.mockRestore();
	revokeUrl.mockRestore();
	browserSettings.disableIframePageLoading = priorIframeLoading;
});
function doc(
	path: string,
	content: ContentState,
	id = path,
): SharedFileDocument {
	return {
		id,
		absolutePath: path,
		workspaceId: "workspace",
		content,
		dirty: false,
		pendingSave: false,
		saveError: null,
		conflict: null,
		orphaned: false,
		hasExternalChange: false,
		isBinary: content.kind === "bytes",
		byteSize: 12,
		setContent: () => {
			throw new Error("preview must not write");
		},
		save: async () => {
			throw new Error("preview must not save");
		},
		compareWithDisk: async () => {},
		reload: async () => {},
		loadUnlimited: async () => {},
		resolveConflict: async () => {},
		clearSaveError: () => {},
		subscribe: () => () => {},
		getVersion: () => 0,
	};
}
const callbacks = {
	onSave: () => {
		throw new Error("must not save bytes");
	},
	onClose: () => {},
	onFocusChange: () => {},
	onError: () => {},
};
const bytes = {
	kind: "bytes" as const,
	value: new Uint8Array([137, 80, 78, 71]),
	revision: "revision",
};
test("a remote image reuses the original image surface and keyboard zoom without a text editor or save", async () => {
	render(
		<RemoteDocumentEditor
			document={doc("/remote/worktree/picture.png", bytes)}
			active
			busy={false}
			{...callbacks}
		/>,
	);
	const surface = await screen.findByRole("application", {
		name: /Image preview of picture.png/,
	});
	const image = (await screen.findByRole("img", {
		name: "picture.png",
	})) as HTMLImageElement;
	expect(image.src.startsWith("blob:")).toBe(true);
	expect(screen.queryByRole("button", { name: "Save file" })).toBeNull();
	expect(document.querySelector(".cm-editor")).toBeNull();
	fireEvent.keyDown(surface, { key: "+" });
	expect(screen.getByTitle("Reset zoom").textContent).toBe("125%");
	fireEvent.keyDown(surface, { key: "0" });
	expect(screen.queryByTitle("Reset zoom")).toBeNull();
});
test("unknown bytes retain the read-only binary message", async () => {
	render(
		<RemoteDocumentEditor
			document={doc("/remote/worktree/archive.dat", bytes)}
			active
			busy={false}
			{...callbacks}
		/>,
	);
	expect(
		await screen.findByText("Binary files cannot be edited here."),
	).toBeTruthy();
	expect(screen.queryByRole("img")).toBeNull();
	expect(screen.queryByRole("button", { name: "Save file" })).toBeNull();
});
test("an oversized image cannot bypass the document size limit", async () => {
	render(
		<RemoteDocumentEditor
			document={doc("/remote/worktree/large.png", { kind: "too-large" })}
			active
			busy={false}
			{...callbacks}
		/>,
	);
	expect(
		await screen.findByText("This preview is truncated. Saving is disabled."),
	).toBeTruthy();
	expect(screen.queryByRole("img")).toBeNull();
	expect(
		(screen.getByRole("button", { name: "Save file" }) as HTMLButtonElement)
			.disabled,
	).toBe(true);
});
test("an image decode error is visible and changing the owning document clears the old preview", async () => {
	const view = render(
		<RemoteDocumentEditor
			document={doc("/remote/worktree/picture.png", bytes, "owner-a")}
			active
			busy={false}
			{...callbacks}
		/>,
	);
	const first = (await screen.findByRole("img", {
		name: "picture.png",
	})) as HTMLImageElement;
	const oldSource = first.src;
	fireEvent.error(first);
	expect((await screen.findByRole("alert")).textContent).toContain(
		"Failed to load image",
	);
	view.rerender(
		<RemoteDocumentEditor
			document={doc("/remote/worktree/picture.png", bytes, "owner-b")}
			active
			busy={false}
			{...callbacks}
		/>,
	);
	const next = (await screen.findByRole("img", {
		name: "picture.png",
	})) as HTMLImageElement;
	expect(next.src).not.toBe(oldSource);
	expect(revokeUrl).toHaveBeenCalledWith(oldSource);
	expect(screen.queryByRole("alert")).toBeNull();
});

test("markdown defaults to the original rich preview and can switch to the shared source document", async () => {
	const value =
		"---\ntitle: keep exactly\n---\n# Remote markdown\n\n| A | B |\n|---|---|\n| One | Two |\n";
	render(
		<RemoteDocumentEditor
			document={doc("/remote/worktree/README.md", {
				kind: "text",
				value,
				revision: "r1",
			})}
			active
			busy={false}
			{...callbacks}
		/>,
	);
	expect(
		await screen.findByRole("heading", { name: "Remote markdown" }),
	).toBeTruthy();
	expect(screen.getByRole("table")).toBeTruthy();
	expect(screen.queryByText("title: keep exactly")).toBeNull();
	fireEvent.click(screen.getByRole("button", { name: "Markdown" }));
	await screen.findByRole("region", { name: "File contents" });
	expect(document.querySelector(".markdown-renderer")).toBeNull();
	fireEvent.click(screen.getByRole("button", { name: "Preview" }));
	expect(
		await screen.findByRole("heading", { name: "Remote markdown" }),
	).toBeTruthy();
});
test("a markdown search destination opens the source view at the requested line", async () => {
	render(
		<RemoteDocumentEditor
			document={doc("/remote/worktree/README.md", {
				kind: "text",
				value: "# Preview\n\nneedle\n",
				revision: "r1",
			})}
			active
			busy={false}
			revealLine={3}
			{...callbacks}
		/>,
	);
	expect(await screen.findByRole("button", { name: "Preview" })).toBeTruthy();
	expect(
		await screen.findByRole("region", { name: "File contents" }),
	).toBeTruthy();
	expect(document.querySelector(".markdown-renderer")).toBeNull();
});

test("rich markdown edits share the source draft, preserve front matter, and save only explicitly with the disk revision", async () => {
	const frontMatter = "\ufeff---\ntitle: keep exactly\n---\n";
	const source = frontMatter + "# Rich document\n\nOriginal paragraph.\n";
	const calls: DirectRpc[] = [];
	const api = {
		rpc: async (r: DirectRpc) => {
			calls.push(r);
			return r.path === "filesystem.readFile"
				? {
						kind: "text",
						content: source,
						revision: "r1",
						exceededLimit: false,
						byteLength: source.length,
					}
				: { ok: true, revision: "r2" };
		},
	} as unknown as DirectWorkstationApi;
	const connection: DirectDescriptor = {
		connectionId: "machine",
		backendId: "backend",
		namespaceId: "namespace",
		instanceId: "instance",
		generation: 1,
		capabilities: { files: true },
	};
	const manager = new WorkstationFileDocuments(api);
	const shared = manager.acquire(
		connection,
		"workspace",
		"/remote/worktree/README.md",
	);
	await waitFor(() => expect(shared.content.kind).toBe("text"));
	const props = {
		document: shared,
		active: true,
		busy: false,
		...callbacks,
		onSave: () => void shared.save(),
	};
	const view = render(<RemoteDocumentEditor {...props} />);
	await screen.findByRole("heading", { name: "Rich document" });
	expect(screen.queryByText("title: keep exactly")).toBeNull();
	const rich = (
		document.querySelector(".tiptap") as HTMLElement & { editor: Editor }
	).editor;
	act(() => {
		rich.commands.insertContentAt(
			rich.state.doc.content.size,
			"Added in rich preview.",
		);
	});
	expect(shared.dirty).toBe(true);
	expect(calls.filter((r) => r.type === "mutation")).toEqual([]);
	expect(
		shared.content.kind === "text" &&
			shared.content.value.startsWith(frontMatter),
	).toBe(true);
	const draft = shared.content.kind === "text" ? shared.content.value : "";
	expect(draft).toContain("Added in rich preview.");
	view.rerender(<RemoteDocumentEditor {...props} busy />);
	await waitFor(() =>
		expect(
			document.querySelector(".tiptap")?.getAttribute("contenteditable"),
		).toBe("false"),
	);
	act(() => rich.commands.insertContent("must not alter busy document"));
	expect(shared.content.kind === "text" ? shared.content.value : "").toBe(
		draft,
	);
	view.rerender(<RemoteDocumentEditor {...props} />);
	fireEvent.click(screen.getByRole("button", { name: "Markdown" }));
	await waitFor(() =>
		expect(document.querySelector(".cm-editor")).not.toBeNull(),
	);
	fireEvent.click(screen.getByRole("button", { name: "Save file" }));
	await waitFor(() =>
		expect(calls.filter((r) => r.type === "mutation")).toHaveLength(1),
	);
	expect(calls.find((r) => r.type === "mutation")).toMatchObject({
		connectionId: "machine",
		generation: 1,
		path: "filesystem.writeFile",
		input: {
			workspaceId: "workspace",
			absolutePath: "/remote/worktree/README.md",
			content: draft,
			precondition: { ifMatch: "r1" },
		},
	});
});

test("markdown links use explicit modifier clicks and local image sources use the selected workspace reader", async () => {
	const paths: unknown[] = [];
	const urls: string[] = [];
	render(
		<RemoteDocumentEditor
			document={doc("/remote/worktree/docs/README.md", {
				kind: "text",
				value:
					"# Links\n\n[Open](https://example.invalid/)\n\n![plot](../assets/plot.png)\n",
				revision: "r1",
			})}
			active
			busy={false}
			{...callbacks}
			onOpenUrl={async (url) => {
				urls.push(url);
			}}
			markdownResources={{
				owner: "selected-backend",
				rootPath: "/remote/worktree",
				readFile: async (path, revision) => {
					paths.push({ path, revision });
					return bytes.value;
				},
			}}
		/>,
	);
	const link = await screen.findByRole("link", { name: "Open" });
	fireEvent.click(link);
	expect(urls).toEqual([]);
	fireEvent.click(link, { ctrlKey: true });
	expect(urls).toEqual(["https://example.invalid/"]);
	await screen.findByRole("img", { name: "plot" });
	expect(paths).toEqual([
		{ path: "/remote/worktree/assets/plot.png", revision: "r1" },
	]);
});

test.each([
	{ target: ".tiptap", busy: false },
	{ target: 'button[title="Preview"]', busy: true },
])("Ctrl+F stays scoped to the selected preview when focus is on %s", async ({
	target,
	busy,
}) => {
	render(
		<RemoteDocumentEditor
			document={doc("/remote/worktree/README.md", {
				kind: "text",
				value: "# Search\n\nOriginal paragraph.\n",
				revision: "r1",
			})}
			active
			busy={busy}
			{...callbacks}
		/>,
	);
	await screen.findByRole("heading", { name: "Search" });
	const focused = document.querySelector(target);
	if (!focused) throw new Error("preview input did not mount");
	fireEvent.keyDown(focused, { key: "f", code: "KeyF", ctrlKey: true });
	expect(await screen.findByRole("textbox", { name: "Find" })).toBeTruthy();
});

test("closing rich preview search returns focus to the same file for the next find", async () => {
	render(
		<RemoteDocumentEditor
			document={doc("/remote/worktree/README.md", {
				kind: "text",
				value: "# Search\n\nOriginal paragraph.\n",
				revision: "r1",
			})}
			active
			busy={false}
			{...callbacks}
		/>,
	);
	await screen.findByRole("heading", { name: "Search" });
	const editor = document.querySelector(".tiptap");
	if (!editor) throw new Error("editor did not mount");
	fireEvent.keyDown(editor, { key: "f", ctrlKey: true });
	const find = await screen.findByRole("textbox", { name: "Find" });
	fireEvent.keyDown(find, { key: "Escape" });
	await waitFor(() =>
		expect(screen.queryByRole("textbox", { name: "Find" })).toBeNull(),
	);
	expect(document.activeElement?.closest('[role="tabpanel"]')).not.toBeNull();
	const focused = document.activeElement;
	if (!focused) throw new Error("no focused file");
	fireEvent.keyDown(focused, { key: "f", ctrlKey: true });
	expect(await screen.findByRole("textbox", { name: "Find" })).toBeTruthy();
});

test.each([
	{ path: "/remote/worktree/report.pdf", tag: "iframe" },
	{ path: "/remote/worktree/clip.webm", tag: "video" },
])("recognized media uses the original %s view without text editing or autoplay", async ({
	path,
	tag,
}) => {
	render(
		<RemoteDocumentEditor
			document={doc(path, bytes)}
			active
			busy={false}
			{...callbacks}
		/>,
	);
	await waitFor(() => expect(document.querySelector(tag)).not.toBeNull());
	const media = document.querySelector<HTMLIFrameElement | HTMLVideoElement>(
		tag,
	);
	if (!media) throw new Error("media view did not mount");
	expect(media.src.startsWith("blob:")).toBe(true);
	expect(document.querySelector(".cm-editor")).toBeNull();
	expect(screen.queryByRole("button", { name: "Save file" })).toBeNull();
	if (media instanceof HTMLVideoElement) {
		expect(media.controls).toBe(true);
		expect(media.autoplay).toBe(false);
		expect(media.preload).toBe("metadata");
	}
});

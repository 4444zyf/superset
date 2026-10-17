import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type {
	SharedFileDocument,
	ContentState,
} from "renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/state/fileDocumentStore/types";
import { RemoteDocumentEditor } from "./RemoteDocumentEditor";
let sequence = 0;
let createUrl: ReturnType<typeof spyOn<typeof URL, "createObjectURL">>;
let revokeUrl: ReturnType<typeof spyOn<typeof URL, "revokeObjectURL">>;
beforeEach(() => {
	createUrl = spyOn(URL, "createObjectURL").mockImplementation(
		() => `blob:preview-${++sequence}`,
	);
	revokeUrl = spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
});
afterEach(() => {
	cleanup();
	createUrl.mockRestore();
	revokeUrl.mockRestore();
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

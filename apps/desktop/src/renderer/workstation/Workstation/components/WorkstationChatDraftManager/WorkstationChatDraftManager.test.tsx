import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
	within,
} from "@testing-library/react";
import type { WorkstationChatDraftUpdate } from "../../../../../shared/workstation-chat-drafts";
import { WorkstationChatDraftStore } from "../../providers/WorkstationChatDrafts/workstation-chat-drafts";
import { WorkstationChatDraftManager } from "./WorkstationChatDraftManager";

const browser = (
	window as unknown as { happyDOM: { setURL(url: string): void } }
).happyDOM;
let previousUrl = "";
beforeEach(() => {
	previousUrl = window.location.href;
	browser.setURL(
		"file:///workspace/superset/apps/desktop/dist/renderer/index.html",
	);
});
afterEach(() => {
	cleanup();
	browser.setURL(previousUrl);
});
const identity = {
	connectionId: "offline",
	backendId: "old-backend",
	namespaceId: "namespace",
	workspaceId: "deleted-workspace",
	sessionId: "removed-session",
};
const noTimer = () => () => {};
const value = {
	text: "copy 中文 🙂\nexact",
	attachments: [
		{
			attachmentId: "image",
			originalFilename: "image.png",
			mediaType: "image/png",
			sizeBytes: 6,
		},
	],
};
function card() {
	const article = screen.getByDisplayValue(/copy 中文/).closest("article");
	if (!article) throw new Error("Missing draft card");
	return within(article);
}
async function confirm() {
	await act(async () =>
		fireEvent.click(
			within(await screen.findByRole("alertdialog")).getByRole("button", {
				name: "Discard changes",
			}),
		),
	);
}

test("original copy action copies the exact local text without modifying or persisting drafts", async () => {
	const store = new WorkstationChatDraftStore({}, noTimer);
	store.change(identity, value);
	await store.flush();
	const copied = spyOn(navigator.clipboard, "writeText").mockResolvedValue();
	try {
		render(
			<WorkstationChatDraftManager
				store={store}
				profiles={[]}
				onClose={() => {}}
			/>,
		);
		fireEvent.click(card().getByRole("button", { name: "Copy" }));
		await waitFor(() => expect(copied).toHaveBeenCalledWith(value.text));
		expect(store.get(identity)).toEqual(value);
	} finally {
		copied.mockRestore();
		store.stop();
	}
});

test("failed confirmed discard retains text and references in the original confirmation until an explicit retry succeeds", async () => {
	let fail = false,
		revision = 0;
	const writes: WorkstationChatDraftUpdate[] = [];
	const store = new WorkstationChatDraftStore(
		{
			saveChatDrafts: async (input) => {
				writes.push(input);
				if (fail) throw new Error("Disk full");
				return { revision: ++revision, invalid: false, entries: input.entries };
			},
		},
		noTimer,
	);
	store.change(identity, value);
	await store.flush();
	fail = true;
	render(
		<WorkstationChatDraftManager
			store={store}
			profiles={[]}
			onClose={() => {}}
		/>,
	);
	fireEvent.click(card().getByRole("button", { name: "Discard changes" }));
	await confirm();
	expect(
		within(screen.getByRole("alertdialog")).getByText("Disk full"),
	).toBeTruthy();
	expect(store.get(identity)).toEqual(value);
	expect(writes).toHaveLength(2);
	fail = false;
	await confirm();
	expect(screen.queryByRole("alertdialog")).toBeNull();
	expect(screen.getByText("No chat drafts.")).toBeTruthy();
	expect(writes).toHaveLength(3);
	expect(writes[2]?.entries).toEqual([]);
	store.stop();
});

test("a draft updated after review is preserved and must be reviewed again before discarding", async () => {
	const store = new WorkstationChatDraftStore({}, noTimer);
	store.change(identity, value);
	render(
		<WorkstationChatDraftManager
			store={store}
			profiles={[]}
			onClose={() => {}}
		/>,
	);
	fireEvent.click(card().getByRole("button", { name: "Discard changes" }));
	await screen.findByRole("alertdialog");
	await act(async () =>
		store.change(identity, { ...value, text: "new edit and references" }),
	);
	await confirm();
	expect(
		within(screen.getByRole("alertdialog")).getByText(
			"This draft changed. Review it before discarding.",
		),
	).toBeTruthy();
	expect(store.get(identity).text).toBe("new edit and references");
	store.stop();
});

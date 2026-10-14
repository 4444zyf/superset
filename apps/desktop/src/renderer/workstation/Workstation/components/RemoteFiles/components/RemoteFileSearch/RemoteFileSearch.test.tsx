import { afterEach, beforeEach, expect, test } from "bun:test";
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
import { RemoteFileSearch } from "./RemoteFileSearch";

let originalUrl: string;
const dom = window as unknown as { happyDOM: { setURL(url: string): void } };
beforeEach(() => {
	originalUrl = window.location.href;
	dom.happyDOM.setURL("http://localhost:5173/");
});
afterEach(() => {
	cleanup();
	dom.happyDOM.setURL(originalUrl);
});
const connection: DirectDescriptor = {
	connectionId: "mini",
	generation: 3,
	backendId: "b",
	namespaceId: "n",
	instanceId: "i",
	capabilities: { workstationFilesV1: true },
};
function fixture(reply: (request: DirectRpc) => Promise<unknown>) {
	const calls: DirectRpc[] = [];
	const opened: { path: string; line?: number }[] = [];
	return {
		calls,
		opened,
		props: {
			api: {
				rpc: async (request: DirectRpc) => {
					calls.push(request);
					return reply(request);
				},
			} as DirectWorkstationApi,
			connection,
			workspaceId: "ws",
			onOpen: (path: string, line?: number) => opened.push({ path, line }),
			onError: () => {},
		},
	};
}

test("file search uses a bounded query against the selected workspace and opens the returned path", async () => {
	const f = fixture(async () => ({
		matches: [
			{
				absolutePath: "/repo/note.txt",
				relativePath: "note.txt",
				name: "note.txt",
				kind: "file",
				score: 1,
			},
		],
	}));
	render(<RemoteFileSearch {...f.props} />);
	fireEvent.change(screen.getByLabelText("Search files"), {
		target: { value: "note" },
	});
	fireEvent.click(screen.getByRole("button", { name: "Search" }));
	fireEvent.click(await screen.findByRole("button", { name: "note.txt" }));
	expect(f.calls[0]).toMatchObject({
		connectionId: "mini",
		generation: 3,
		path: "filesystem.searchFiles",
		type: "query",
		input: { workspaceId: "ws", query: "note", limit: 100 },
	});
	expect(f.opened).toEqual([{ path: "/repo/note.txt", line: undefined }]);
});

test("content results retain their line and display preview as text", async () => {
	const f = fixture(async () => ({
		matches: [
			{
				absolutePath: "/repo/note.txt",
				relativePath: "note.txt",
				line: 12,
				column: 2,
				preview: "<script>alert(1)</script>",
			},
		],
	}));
	render(<RemoteFileSearch {...f.props} />);
	fireEvent.click(screen.getByRole("button", { name: "Content" }));
	fireEvent.change(screen.getByLabelText("Search files"), {
		target: { value: "needle" },
	});
	fireEvent.click(screen.getByRole("button", { name: "Search" }));
	fireEvent.click(await screen.findByRole("button", { name: /note.txt:12/ }));
	expect(f.calls[0]?.path).toBe("filesystem.searchContent");
	expect(f.opened).toEqual([{ path: "/repo/note.txt", line: 12 }]);
	expect(document.querySelector("script")).toBeNull();
});

test("a reply from the old workspace cannot populate results in the next workspace", async () => {
	let finish!: (value: unknown) => void;
	const f = fixture(
		() =>
			new Promise((resolve) => {
				finish = resolve;
			}),
	);
	const view = render(<RemoteFileSearch {...f.props} />);
	fireEvent.change(screen.getByLabelText("Search files"), {
		target: { value: "old" },
	});
	fireEvent.click(screen.getByRole("button", { name: "Search" }));
	view.rerender(<RemoteFileSearch {...f.props} workspaceId="next" />);
	await act(async () =>
		finish({
			matches: [
				{
					absolutePath: "/repo/old.txt",
					relativePath: "old.txt",
					name: "old.txt",
					kind: "file",
					score: 1,
				},
			],
		}),
	);
	expect(screen.queryByText("old.txt")).toBeNull();
});

test("an older backend cannot issue search queries", () => {
	const f = fixture(async () => ({ matches: [] }));
	render(
		<RemoteFileSearch
			{...f.props}
			connection={{ ...connection, capabilities: { files: true } }}
		/>,
	);
	fireEvent.change(screen.getByLabelText("Search files"), {
		target: { value: "note" },
	});
	fireEvent.click(screen.getByRole("button", { name: "Search" }));
	expect(f.calls).toEqual([]);
});

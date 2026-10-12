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
	DirectSocketEvent,
	DirectWorkstationApi,
} from "../../../../../shared/direct-workstation";
import { RemoteChat } from "./RemoteChat";

afterEach(cleanup);
const connection: DirectDescriptor = {
	connectionId: "machine",
	generation: 1,
	backendId: "backend",
	namespaceId: "namespace",
	instanceId: "instance",
	capabilities: { durableOperations: true, attachments: true },
	chatHarnesses: [{ id: "codex", available: true }],
};

test("closing the chat view closes only its stream, without cancelling or closing B's chat", async () => {
	const procedures: string[] = [];
	const closed: string[] = [];
	let subscribed = 0;
	let socketId = "";
	let finishOpen!: () => void;
	const opening = new Promise<void>((resolve) => {
		finishOpen = resolve;
	});
	const api = {
		rpc: async (request: { path: string }) => {
			procedures.push(request.path);
			return [{ sessionId: "session", harness: "codex" }];
		},
		onSocket: () => {
			subscribed += 1;
			return () => {
				subscribed -= 1;
			};
		},
		openSocket: (_connection: unknown, path: string, id: string) => {
			expect(path).toBe("/chat-v3/sessions/session/stream");
			socketId = id;
			return opening;
		},
		closeSocket: async (id: string) => {
			closed.push(id);
		},
	} as unknown as DirectWorkstationApi;
	const rendered = render(
		<RemoteChat
			api={api}
			connection={connection}
			workspaceId="workspace"
			onError={() => {}}
		/>,
	);
	await waitFor(() => expect(socketId).not.toBe(""));
	rendered.unmount();
	expect(subscribed).toBe(0);
	expect(closed).toEqual([socketId]);
	finishOpen();
	await waitFor(() => expect(closed).toEqual([socketId, socketId]));
	expect(procedures).toEqual(["chat.listSessions"]);
});

test("an attachment replayed from chat history remains downloadable after reconnect", async () => {
	let listener!: (event: DirectSocketEvent) => void;
	let socketId = "";
	const reads: string[] = [];
	const saved: unknown[] = [];
	const api = {
		rpc: async () => [{ sessionId: "session", harness: "codex" }],
		onSocket: (callback: (event: DirectSocketEvent) => void) => {
			listener = callback;
			return () => {};
		},
		openSocket: async (_connection: unknown, _path: string, id: string) => {
			socketId = id;
		},
		closeSocket: async () => {},
		readAttachment: async (_connection: unknown, id: string) => {
			reads.push(id);
			return {
				bytes: new Uint8Array([65]),
				mimeType: "text/plain",
				fileName: "report.txt",
			};
		},
	} as unknown as DirectWorkstationApi;
	render(
		<RemoteChat
			api={api}
			connection={connection}
			workspaceId="workspace"
			onError={() => {}}
			saveAttachment={(attachment) => {
				saved.push(attachment);
			}}
		/>,
	);
	await waitFor(() => expect(socketId).not.toBe(""));
	act(() =>
		listener({
			socketId,
			kind: "message",
			data: JSON.stringify({
				v: 1,
				sessionId: "session",
				ts: 1,
				cursor: { epoch: "boot", seq: 1 },
				event: {
					type: "item",
					turnId: "turn",
					item: {
						id: "item",
						kind: "user_message",
						startedAtMs: 1,
						content: [
							{
								type: "attachment",
								attachmentId: "0f9c00ca-67c8-4f1d-ac3e-ea7eebbf126c",
								name: "report.txt",
								mimeType: "text/plain",
							},
						],
					},
				},
			}),
		}),
	);
	fireEvent.click(await screen.findByRole("button", { name: "report.txt" }));
	await waitFor(() => expect(saved).toHaveLength(1));
	expect(reads).toEqual(["0f9c00ca-67c8-4f1d-ac3e-ea7eebbf126c"]);
	expect(saved[0]).toMatchObject({
		fileName: "report.txt",
		bytes: new Uint8Array([65]),
	});
});

test("reconnecting keeps the selected remote chat and never repeats a prompt", async () => {
	const opened: { generation: number; path: string }[] = [];
	const procedures: string[] = [];
	const rows = [
		{ sessionId: "first", harness: "codex" },
		{ sessionId: "second", harness: "codex" },
	];
	let finishRefresh!: (refreshedRows: typeof rows) => void;
	const refresh = new Promise<typeof rows>((resolve) => {
		finishRefresh = resolve;
	});
	const onError = () => {};
	const api = {
		rpc: async (request: { path: string }) => {
			procedures.push(request.path);
			return procedures.length === 1 ? rows : refresh;
		},
		onSocket: () => () => {},
		openSocket: async (connection: DirectDescriptor, path: string) => {
			opened.push({ generation: connection.generation, path });
		},
		closeSocket: async () => {},
	} as unknown as DirectWorkstationApi;
	const rendered = render(
		<RemoteChat
			api={api}
			connection={connection}
			workspaceId="workspace"
			onError={onError}
		/>,
	);
	fireEvent.click(await screen.findByRole("button", { name: "codex #2" }));
	await waitFor(() =>
		expect(opened.at(-1)?.path).toBe("/chat-v3/sessions/second/stream"),
	);
	rendered.rerender(
		<RemoteChat
			api={api}
			connection={{ ...connection, generation: 3 }}
			workspaceId="workspace"
			onError={onError}
		/>,
	);
	await act(async () => {
		finishRefresh(rows);
		await refresh;
	});
	await waitFor(() =>
		expect(opened.at(-1)).toEqual({
			generation: 3,
			path: "/chat-v3/sessions/second/stream",
		}),
	);
	expect(procedures).toEqual(["chat.listSessions", "chat.listSessions"]);
});

const attachment = {
	attachmentId: "0f9c00ca-67c8-4f1d-ac3e-ea7eebbf126c",
	originalFilename: "selected.txt",
	mediaType: "text/plain",
	sizeBytes: 5,
};

function attachmentFixture() {
	const calls: { path: string; input?: unknown }[] = [];
	const api = {
		rpc: async (request: { path: string; input?: unknown }) => {
			calls.push(request);
			if (request.path === "chat.listSessions")
				return [
					{ sessionId: "first", harness: "codex" },
					{ sessionId: "second", harness: "codex" },
				];
			if (request.path === "chat.prompt") return { accepted: true };
			throw new Error(`Unexpected procedure ${request.path}`);
		},
		onSocket: () => () => {},
		openSocket: async () => {},
		closeSocket: async () => {},
		chooseAttachment: async () => attachment,
		readAttachment: async () => ({
			bytes: new Uint8Array([104, 101, 108, 108, 111]),
			mimeType: "text/plain",
			fileName: "selected.txt",
		}),
	} as unknown as DirectWorkstationApi;
	return { api, calls };
}

test("switching chats clears unsent message and attachment drafts", async () => {
	const { api } = attachmentFixture();
	render(
		<RemoteChat
			api={api}
			connection={connection}
			workspaceId="workspace"
			onError={() => {}}
		/>,
	);
	fireEvent.click(await screen.findByRole("button", { name: "Attach files" }));
	await screen.findByRole("button", { name: "selected.txt" });
	fireEvent.change(screen.getByLabelText("Message"), {
		target: { value: "only for the first chat" },
	});
	fireEvent.click(screen.getByRole("button", { name: "codex #2" }));
	expect((screen.getByLabelText("Message") as HTMLTextAreaElement).value).toBe(
		"",
	);
	expect(screen.queryByRole("button", { name: "selected.txt" })).toBeNull();
});

test("an upload completed after switching chats cannot attach to the new chat", async () => {
	const { api } = attachmentFixture();
	let finishUpload!: (result: typeof attachment) => void;
	api.chooseAttachment = () =>
		new Promise((resolve) => {
			finishUpload = resolve;
		});
	render(
		<RemoteChat
			api={api}
			connection={connection}
			workspaceId="workspace"
			onError={() => {}}
		/>,
	);
	fireEvent.click(await screen.findByRole("button", { name: "Attach files" }));
	fireEvent.click(screen.getByRole("button", { name: "codex #2" }));
	await act(async () => finishUpload(attachment));
	expect(screen.queryByRole("button", { name: "selected.txt" })).toBeNull();
});

test("returning to a chat cannot revive an old upload or clear a newer upload's busy state", async () => {
	const { api } = attachmentFixture();
	const finishes: ((result: typeof attachment) => void)[] = [];
	api.chooseAttachment = () => new Promise((resolve) => finishes.push(resolve));
	render(
		<RemoteChat
			api={api}
			connection={connection}
			workspaceId="workspace"
			onError={() => {}}
		/>,
	);
	fireEvent.click(await screen.findByRole("button", { name: "Attach files" }));
	fireEvent.click(screen.getByRole("button", { name: "codex #2" }));
	fireEvent.click(screen.getByRole("button", { name: "codex #1" }));
	fireEvent.click(screen.getByRole("button", { name: "Attach files" }));
	expect(finishes).toHaveLength(2);
	await act(async () => finishes[0]?.(attachment));
	expect(Boolean(screen.queryByRole("button", { name: "selected.txt" }))).toBe(
		false,
	);
	expect(
		(screen.getByRole("button", { name: "Attach files" }) as HTMLButtonElement)
			.disabled,
	).toBe(true);
	await act(async () =>
		finishes[1]?.({ ...attachment, originalFilename: "current.txt" }),
	);
	expect(Boolean(screen.queryByRole("button", { name: "current.txt" }))).toBe(
		true,
	);
	expect(
		(screen.getByRole("button", { name: "Attach files" }) as HTMLButtonElement)
			.disabled,
	).toBe(false);
});

test("an older session list cannot erase a newly created chat", async () => {
	const { api } = attachmentFixture();
	let finishList!: (rows: unknown[]) => void;
	api.rpc = async <T,>(request: { path: string }) => {
		if (request.path === "chat.listSessions")
			return await new Promise<T>((resolve) => {
				finishList = (rows) => resolve(rows as T);
			});
		if (request.path === "chat.createSession")
			return { sessionId: "created" } as T;
		throw new Error(`Unexpected procedure ${request.path}`);
	};
	render(
		<RemoteChat
			api={api}
			connection={connection}
			workspaceId="workspace"
			onError={() => {}}
		/>,
	);
	await act(async () =>
		fireEvent.click(screen.getByRole("button", { name: "New chat" })),
	);
	expect(Boolean(screen.queryByLabelText("Message"))).toBe(true);
	await act(async () => finishList([]));
	expect(Boolean(screen.queryByLabelText("Message"))).toBe(true);
	expect(Boolean(screen.queryByRole("button", { name: "codex #1" }))).toBe(
		true,
	);
});

test("a download completed after changing workspace cannot save stale attachment bytes", async () => {
	const { api } = attachmentFixture();
	const saved: unknown[] = [];
	let finishDownload!: (
		result: Awaited<ReturnType<DirectWorkstationApi["readAttachment"]>>,
	) => void;
	api.readAttachment = () =>
		new Promise((resolve) => {
			finishDownload = resolve;
		});
	const props = {
		api,
		connection,
		onError: () => {},
		saveAttachment: (result: unknown) => saved.push(result),
	};
	const view = render(<RemoteChat {...props} workspaceId="first-workspace" />);
	fireEvent.click(await screen.findByRole("button", { name: "Attach files" }));
	fireEvent.click(await screen.findByRole("button", { name: "selected.txt" }));
	view.rerender(<RemoteChat {...props} workspaceId="second-workspace" />);
	await act(async () =>
		finishDownload({
			bytes: new Uint8Array([1]),
			fileName: "stale.txt",
			mimeType: "text/plain",
		}),
	);
	expect(saved).toEqual([]);
});

test("attachment controls require the backend's attachment capability", async () => {
	const { api } = attachmentFixture();
	render(
		<RemoteChat
			api={api}
			connection={{
				...connection,
				capabilities: { durableOperations: true, attachments: false },
			}}
			workspaceId="workspace"
			onError={() => {}}
		/>,
	);
	const attach = (await screen.findByRole("button", {
		name: "Attach files",
	})) as HTMLButtonElement;
	expect(attach.disabled).toBe(true);
});

test("an uploaded attachment is referenced once by opaque id in the selected chat prompt", async () => {
	const { api, calls } = attachmentFixture();
	render(
		<RemoteChat
			api={api}
			connection={connection}
			workspaceId="workspace"
			onError={() => {}}
		/>,
	);
	fireEvent.click(await screen.findByRole("button", { name: "Attach files" }));
	await screen.findByRole("button", { name: "selected.txt" });
	fireEvent.change(screen.getByLabelText("Message"), {
		target: { value: "read the attachment" },
	});
	await act(async () =>
		fireEvent.click(screen.getByRole("button", { name: "Send" })),
	);
	const prompts = calls.filter((call) => call.path === "chat.prompt");
	expect(prompts).toHaveLength(1);
	expect(prompts[0]?.input).toMatchObject({
		sessionId: "first",
		content: [
			{ type: "text", text: "read the attachment" },
			{
				type: "attachment",
				attachmentId: attachment.attachmentId,
				name: "selected.txt",
				mimeType: "text/plain",
			},
		],
	});
	expect(screen.queryByRole("button", { name: "selected.txt" })).toBeNull();
});

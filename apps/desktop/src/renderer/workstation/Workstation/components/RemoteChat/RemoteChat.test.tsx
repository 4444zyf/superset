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
test("changing pane callbacks does not reopen a restored chat stream", async () => {
	let opens = 0;
	let closes = 0;
	const api = {
		rpc: async () => [],
		onSocket: () => () => {},
		openSocket: async () => {
			opens++;
		},
		closeSocket: async () => {
			closes++;
		},
	} as unknown as DirectWorkstationApi;
	const view = render(
		<RemoteChat
			api={api}
			connection={connection}
			workspaceId="workspace"
			selectedSessionId="saved"
			onError={() => {}}
			onAttached={() => {}}
		/>,
	);
	await waitFor(() => expect(opens).toBe(1));
	view.rerender(
		<RemoteChat
			api={api}
			connection={connection}
			workspaceId="workspace"
			selectedSessionId="saved"
			onError={() => {}}
			onAttached={() => {}}
		/>,
	);
	expect(opens).toBe(1);
	expect(closes).toBe(0);
});
const connection: DirectDescriptor = {
	connectionId: "machine",
	generation: 1,
	backendId: "backend",
	namespaceId: "namespace",
	instanceId: "instance",
	capabilities: { durableOperations: true, attachments: true },
	chatHarnesses: [{ id: "codex", available: true }],
};

test("restoring a controlled chat selection never selects the first session or sends a prompt", async () => {
	const paths: string[] = [];
	const procedures: string[] = [];
	const selected: unknown[] = [];
	const api = {
		rpc: async (request: { path: string; type: string }) => {
			procedures.push(request.type);
			return [
				{ sessionId: "first", harness: "codex" },
				{ sessionId: "saved", harness: "codex" },
			];
		},
		onSocket: () => () => {},
		openSocket: async (_connection: unknown, path: string) => {
			paths.push(path);
		},
		closeSocket: async () => {},
	} as unknown as DirectWorkstationApi;
	render(
		<RemoteChat
			api={api}
			connection={connection}
			workspaceId="workspace"
			selectedSessionId="saved"
			onSessionSelected={(id) => selected.push(id)}
			onError={() => {}}
		/>,
	);
	await waitFor(() =>
		expect(paths).toContain("/chat-v3/sessions/saved/stream"),
	);
	expect(paths).not.toContain("/chat-v3/sessions/first/stream");
	expect(selected).toEqual([]);
	expect(procedures.every((type) => type === "query")).toBe(true);
});

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

test("pasted images upload to the selected chat without sending a prompt", async () => {
	const uploads: unknown[] = [];
	const mutations: unknown[] = [];
	const api = {
		rpc: async (r: { type: string }) => {
			if (r.type === "mutation") mutations.push(r);
			return [];
		},
		onSocket: () => () => {},
		openSocket: async () => {},
		closeSocket: async () => {},
		uploadAttachment: async (c: unknown, f: unknown) => {
			uploads.push({ c, f });
			return {
				attachmentId: "pasted",
				originalFilename: "image.png",
				mediaType: "image/png",
				sizeBytes: 3,
			};
		},
	} as unknown as DirectWorkstationApi;
	render(
		<RemoteChat
			api={api}
			connection={connection}
			workspaceId="workspace"
			selectedSessionId="saved"
			onError={() => {}}
		/>,
	);
	const area = await screen.findByRole("textbox", { name: "Message" });
	fireEvent.paste(area, {
		clipboardData: {
			files: [
				new File([new Uint8Array([1, 2, 3])], "image.png", {
					type: "image/png",
				}),
			],
			getData: () => "",
		},
	});
	await waitFor(() => expect(uploads).toHaveLength(1));
	expect(screen.getByRole("button", { name: "image.png" })).toBeTruthy();
	expect(mutations).toEqual([]);
});

test("a pasted image completing after switching chats is not attached or sent", async () => {
	let finish!: (value: unknown) => void;
	let started = 0;
	const errors: string[] = [];
	const api = {
		rpc: async () => [],
		onSocket: () => () => {},
		openSocket: async () => {},
		closeSocket: async () => {},
		uploadAttachment: () => {
			started++;
			return new Promise((resolve) => {
				finish = resolve;
			});
		},
	} as unknown as DirectWorkstationApi;
	const props = {
		api,
		connection,
		workspaceId: "workspace",
		onError: (e: string) => errors.push(e),
	};
	const view = render(<RemoteChat {...props} selectedSessionId="old" />);
	fireEvent.paste(await screen.findByRole("textbox", { name: "Message" }), {
		clipboardData: {
			files: [new File(["abc"], "image.png", { type: "image/png" })],
			getData: () => "",
		},
	});
	await waitFor(() => expect(started).toBe(1));
	view.rerender(<RemoteChat {...props} selectedSessionId="new" />);
	await act(async () =>
		finish({
			attachmentId: "old-image",
			originalFilename: "image.png",
			mediaType: "image/png",
			sizeBytes: 3,
		}),
	);
	expect(screen.queryByRole("button", { name: "image.png" })).toBeNull();
	expect(errors).toEqual([]);
});

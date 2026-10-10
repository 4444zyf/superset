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
	capabilities: { durableOperations: true },
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

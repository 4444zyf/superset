import { afterEach, expect, test } from "bun:test";
import { act, cleanup, render } from "@testing-library/react";
import type {
	DirectDescriptor,
	DirectSocketEvent,
	DirectWorkstationApi,
} from "../../../../../../../shared/direct-workstation";
import { WorkstationFileDocuments } from "../../../WorkstationFileDocuments";
import { WorkstationDocumentEvents } from "./WorkstationDocumentEvents";

afterEach(cleanup);
const connection: DirectDescriptor = {
	connectionId: "background",
	backendId: "backend",
	namespaceId: "namespace",
	instanceId: "instance",
	generation: 1,
	capabilities: { files: true, workstationFileEventsV1: true },
};
const settle = async () => {
	for (let i = 0; i < 15; i++) await Promise.resolve();
};

test("retained documents receive filesystem changes without a file view and a replacement connection rejects the old stream", async () => {
	let disk = "original";
	const listeners = new Set<(event: DirectSocketEvent) => void>();
	const opened: string[] = [];
	const closed: string[] = [];
	const sent: unknown[] = [];
	const writes: unknown[] = [];
	const api = {
		rpc: async (request: { path: string; input: unknown }) => {
			if (request.path === "workspace.get") return { worktreePath: "/repo" };
			if (request.path === "filesystem.writeFile") {
				writes.push(request.input);
				return { ok: true, revision: "saved" };
			}
			return {
				kind: "bytes",
				content: btoa(disk),
				revision: disk,
				exceededLimit: false,
			};
		},
		onSocket: (listener: (event: DirectSocketEvent) => void) => {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
		openSocket: async (
			_connection: DirectDescriptor,
			_path: string,
			id: string,
		) => {
			opened.push(id);
			queueMicrotask(() => {
				for (const listener of listeners)
					listener({ socketId: id, kind: "open" });
			});
		},
		closeSocket: async (id: string) => {
			closed.push(id);
		},
		sendSocket: async (_id: string, data: string) => {
			sent.push(JSON.parse(data));
		},
	} as unknown as DirectWorkstationApi;
	const manager = new WorkstationFileDocuments(api);
	const doc = manager.acquire(
		connection,
		"workspace",
		"/repo/ignored/note.txt",
	);
	await settle();
	const view = render(
		<WorkstationDocumentEvents
			api={api}
			connection={connection}
			documents={manager}
		/>,
	);
	await act(settle);
	expect(opened).toHaveLength(1);
	expect(sent).toContainEqual({ type: "fs:watch", workspaceId: "workspace" });
	expect(sent).toContainEqual({
		type: "fs:watch-file",
		workspaceId: "workspace",
		absolutePath: "/repo/ignored/note.txt",
	});
	const emit = () => {
		for (const listener of listeners)
			listener({
				socketId: opened[0]!,
				kind: "message",
				data: JSON.stringify({
					type: "fs:events",
					workspaceId: "workspace",
					events: [{ kind: "update", absolutePath: "/repo/ignored/note.txt" }],
				}),
			});
	};
	disk = "changed while terminal is visible";
	await act(async () => {
		emit();
		await settle();
	});
	expect(doc.content).toMatchObject({ value: disk });
	act(() => doc.setContent("private background draft"));
	disk = "external newer bytes";
	await act(async () => {
		emit();
		await settle();
	});
	expect(doc.content).toMatchObject({ value: "private background draft" });
	expect(doc.hasExternalChange).toBe(true);
	expect(writes).toEqual([]);
	view.rerender(
		<WorkstationDocumentEvents
			api={api}
			connection={{ ...connection, generation: 2 }}
			documents={manager}
		/>,
	);
	await act(async () => {
		manager.activate({ ...connection, generation: 2 });
		await settle();
	});
	expect(opened).toHaveLength(2);
	expect(closed).toContain(opened[0]!);
	view.rerender(
		<WorkstationDocumentEvents
			api={api}
			connection={{ ...connection, generation: 3, backendId: "replacement" }}
			documents={manager}
		/>,
	);
	await act(async () => {
		emit();
		await settle();
	});
	expect(closed).toContain(opened[0]!);
	expect(listeners.size).toBe(0);
	expect(doc.content).toMatchObject({ value: "private background draft" });
	view.unmount();
});

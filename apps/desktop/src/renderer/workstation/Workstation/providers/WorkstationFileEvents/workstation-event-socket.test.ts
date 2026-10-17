import { expect, test } from "bun:test";
import { getEventBusForTransport } from "@superset/workspace-client/event-bus-core";
import type {
	DirectDescriptor,
	DirectSocketEvent,
} from "../../../../../shared/direct-workstation";
import { WorkstationEventSocket } from "./workstation-event-socket";

const connection: DirectDescriptor = {
	connectionId: "machine",
	backendId: "backend",
	namespaceId: "namespace",
	instanceId: "instance",
	generation: 3,
};
const settle = async () => {
	for (let i = 0; i < 8; i++) await Promise.resolve();
};
function fixture() {
	const listeners = new Set<(event: DirectSocketEvent) => void>();
	const opened: { connection: DirectDescriptor; path: string; id: string }[] =
		[];
	const sent: { id: string; data: unknown }[] = [];
	const closed: string[] = [];
	const timers = new Map<() => void, number>();
	const api = {
		onSocket: (listener: (event: DirectSocketEvent) => void) => {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
		openSocket: async (
			connection: DirectDescriptor,
			path: string,
			id: string,
		) => {
			opened.push({ connection, path, id });
		},
		sendSocket: async (id: string, data: string) => {
			sent.push({ id, data: JSON.parse(data) });
		},
		closeSocket: async (id: string) => {
			closed.push(id);
		},
	};
	const emit = (id: string, kind: DirectSocketEvent["kind"], data?: string) => {
		for (const listener of listeners)
			listener({
				socketId: id,
				kind,
				...(data === undefined ? {} : { data }),
			} as DirectSocketEvent);
	};
	const schedule = (callback: () => void, delay: number) => {
		timers.set(callback, delay);
		return () => {
			timers.delete(callback);
		};
	};
	return { api, listeners, opened, sent, closed, timers, emit, schedule };
}

function openedId(f: ReturnType<typeof fixture>, index = 0): string {
	const id = f.opened[index]?.id;
	if (!id) throw new Error("Expected an opened event socket");
	return id;
}

test("the original event bus refcounts watches, restores subscriptions after a drop and ignores the old socket", async () => {
	const f = fixture();
	const bus = getEventBusForTransport(
		crypto.randomUUID(),
		() => new WorkstationEventSocket(f.api, connection, f.schedule),
	);
	const release = bus.retain();
	const received: unknown[] = [];
	const off = bus.on("fs:events", "workspace", (_id, payload) =>
		received.push(payload),
	);
	bus.watchFs("workspace");
	bus.watchFs("workspace");
	bus.watchFsFile("workspace", "/repo/ignored/note.txt");
	await settle();
	expect(f.opened).toMatchObject([{ connection, path: "/events" }]);
	const first = openedId(f);
	expect(f.sent).toEqual([]);
	f.emit(first, "open");
	expect(f.sent.map((item) => item.data)).toEqual([
		{ type: "fs:watch", workspaceId: "workspace" },
		{
			type: "fs:watch-file",
			workspaceId: "workspace",
			absolutePath: "/repo/ignored/note.txt",
		},
	]);
	f.emit(first, "close");
	f.emit(first, "error");
	expect(bus.getConnectionStatus().state).toBe("reconnecting");
	expect([...f.timers.values()]).toEqual([1000]);
	const retry = [...f.timers.keys()][0];
	if (!retry) throw new Error("Expected reconnect timer");
	f.timers.delete(retry);
	retry();
	const second = openedId(f, 1);
	f.emit(first, "open");
	f.emit(
		first,
		"message",
		JSON.stringify({ type: "fs:events", workspaceId: "workspace", events: [] }),
	);
	expect(received).toEqual([]);
	f.emit(second, "open");
	expect(f.sent.slice(2).map((item) => item.data)).toEqual(
		f.sent.slice(0, 2).map((item) => item.data),
	);
	f.emit(second, "message", "null");
	f.emit(
		second,
		"message",
		JSON.stringify({ type: "fs:events", workspaceId: "workspace" }),
	);
	f.emit(
		second,
		"message",
		JSON.stringify({ type: "fs:events", workspaceId: "other", events: [] }),
	);
	expect(received).toEqual([]);
	f.emit(
		second,
		"message",
		JSON.stringify({
			type: "fs:events",
			workspaceId: "workspace",
			events: [{ kind: "update", absolutePath: "/repo/note.txt" }],
		}),
	);
	expect(received).toEqual([
		{ events: [{ kind: "update", absolutePath: "/repo/note.txt" }] },
	]);
	bus.unwatchFs("workspace");
	expect(f.sent.at(-1)?.data).not.toMatchObject({ type: "fs:unwatch" });
	bus.unwatchFsFile("workspace", "/repo/ignored/note.txt");
	bus.unwatchFs("workspace");
	off();
	release();
	expect(f.listeners.size).toBe(0);
	expect(f.timers.size).toBe(0);
	expect(f.closed).toContain(second);
});

test("closing a pending event socket cancels retry and discards its late open failure", async () => {
	const f = fixture();
	let fail!: (error: Error) => void;
	f.api.openSocket = async (connection, path, id) => {
		f.opened.push({ connection, path, id });
		await new Promise<void>((_resolve, reject) => {
			fail = reject;
		});
	};
	const socket = new WorkstationEventSocket(f.api, connection, f.schedule);
	let opens = 0;
	socket.addEventListener("open", () => {
		opens++;
	});
	await settle();
	socket.close();
	f.emit(openedId(f), "open");
	fail(new Error("stale generation"));
	await settle();
	expect(opens).toBe(0);
	expect(f.timers.size).toBe(0);
	expect(f.listeners.size).toBe(0);
	expect(f.closed).toEqual([openedId(f)]);
});

test("a backend file watch error recovers the subscription instead of leaving it falsely open", async () => {
	const f = fixture();
	const socket = new WorkstationEventSocket(f.api, connection, f.schedule);
	await settle();
	const id = openedId(f);
	f.emit(id, "open");
	f.emit(
		id,
		"message",
		JSON.stringify({
			type: "error",
			message: "Filesystem event stream failed",
		}),
	);
	expect(socket.readyState).toBe(3);
	expect([...f.timers.values()]).toEqual([1000]);
	socket.close();
	expect(f.timers.size).toBe(0);
});

import { expect, test } from "bun:test";
import type { NodeWebSocket } from "@hono/node-ws";
import { TerminalModes } from "@superset/pty-daemon/terminal-modes";
import { Hono } from "hono";
import type { WSEvents } from "hono/ws";
import type { HostDb } from "../db";
import type { DaemonClient, SubscribeCallbacks } from "./DaemonClient";
import { HeadlessTerminal } from "./headless-xterm";
import { registerTerminalRestoreRoute } from "./restore-route";

async function fixture(fast: boolean) {
	const app = new Hono();
	let hooks: WSEvents | undefined;
	let replay: SubscribeCallbacks | undefined;
	const frames: (string | ArrayBufferLike | Uint8Array)[] = [];
	const inputs: string[] = [];
	const snapshot = new TerminalModes().snapshot();
	const upgrade = ((factory: (c: unknown) => WSEvents) => (c: never) => {
		hooks = factory(c);
		return new Response();
	}) as unknown as NodeWebSocket["upgradeWebSocket"];
	const db = {
		query: {
			workspaces: {
				findFirst: () => ({
					sync: () => ({ archivedAt: null, projectId: null }),
				}),
			},
			terminalSessions: {
				findFirst: () => ({
					sync: () => ({
						originWorkspaceId: "workspace",
						status: "active",
						disposeRequestedAt: null,
					}),
				}),
			},
		},
	} as unknown as HostDb;
	const daemon = {
		supportsConditionalSubscribe: true,
		onDisconnect() {},
		async subscribeExisting(
			_id: string,
			_execution: string,
			cb: SubscribeCallbacks,
		) {
			replay = cb;
			cb.onOutput(Buffer.from("\x1b[>q"));
			if (fast) cb.onReplayComplete?.(snapshot);
			return () => {};
		},
		async dispose() {},
		inputExisting(_id: string, _execution: string, data: Uint8Array) {
			inputs.push(Buffer.from(data).toString());
		},
	} as unknown as DaemonClient;
	registerTerminalRestoreRoute(app, db, upgrade, undefined, async () => daemon);
	await app.request(
		"/terminal-restore/terminal?workspaceId=workspace&executionId=execution",
	);
	const ws = {
		raw: { bufferedAmount: 0 },
		send(data: string | ArrayBufferLike | Uint8Array) {
			frames.push(data);
		},
		close() {},
	};
	if (!hooks?.onOpen) throw new Error("Restore route missing");
	await hooks.onOpen(new Event("open"), ws as never);
	if (!replay) throw new Error("Replay callbacks missing");
	const messages = () =>
		frames
			.filter((f): f is string => typeof f === "string")
			.map((f) => JSON.parse(f));
	return {
		frames,
		inputs,
		input: (data: string) =>
			hooks?.onMessage?.(
				new MessageEvent("message", {
					data: JSON.stringify({ type: "input", data }),
				}),
				ws as never,
			),
		messages,
		replay,
		snapshot,
		close: () => hooks?.onClose?.(new CloseEvent("close"), ws as never),
	};
}

test.each([
	true,
	false,
])("restore marks history before bytes and ends it after daemon replay (fast=%s)", async (fast) => {
	const f = await fixture(fast);
	expect(f.messages()[0]).toEqual({
		type: "attached",
		terminalId: "terminal",
		workspaceId: "workspace",
		executionId: "execution",
		replaying: true,
	});
	if (!fast) {
		expect(f.messages().some((m) => m.type === "replay-complete")).toBe(false);
		f.replay.onReplayComplete?.(f.snapshot);
	}
	expect(f.messages().filter((m) => m.type === "replay-complete")).toHaveLength(
		1,
	);
	expect(JSON.parse(String(f.frames.at(-1)))).toEqual({
		type: "replay-complete",
	});
	f.replay.onOutput(Buffer.from("live output"));
	expect(Buffer.from(f.frames.at(-1) as ArrayBuffer).toString()).toBe(
		"live output",
	);
});

test("an old renderer's historical version response cannot reach the PTY, while live replies and ordinary input can", async () => {
	const f = await fixture(true);
	const terminal = new HeadlessTerminal({ allowProposedApi: true });
	terminal.onData(f.input);
	try {
		for (const frame of f.frames) {
			if (typeof frame !== "string")
				await new Promise<void>((done) =>
					terminal.write(new Uint8Array(frame as ArrayBuffer), done),
				);
		}
		expect(f.inputs).toEqual([]);
		const live = Buffer.from("\x1b[>q");
		f.replay.onOutput(live);
		await new Promise<void>((done) => terminal.write(live, done));
		expect(f.inputs).toHaveLength(1);
		expect(f.inputs[0]).toStartWith("\x1bP>|xterm.js(");
		f.input("echo 普通输入\r");
		expect(f.inputs[1]).toBe("echo 普通输入\r");
	} finally {
		terminal.dispose();
		f.close();
	}
});

test("closing during replay prevents a late completion from reviving the socket", async () => {
	const f = await fixture(false);
	f.close();
	const count = f.frames.length;
	f.replay.onReplayComplete?.(f.snapshot);
	f.replay.onOutput(Buffer.from("late output"));
	expect(f.frames).toHaveLength(count);
});

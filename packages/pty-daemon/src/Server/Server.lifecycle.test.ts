import { afterEach, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	accumulatedOutputAsString,
	connectAndHello,
} from "../../test/helpers/client.ts";
import type { Pty, PtyOnData, PtyOnExit } from "../Pty/index.ts";
import type { SessionMeta } from "../protocol/index.ts";
import { Server } from "./Server.ts";

class CompletingPty implements Pty {
	readonly pid = 12345;
	disposed = false;
	meta: SessionMeta;
	private onOutput: PtyOnData = () => {};
	private onEnd: PtyOnExit = () => {};

	constructor(meta: SessionMeta) {
		this.meta = meta;
	}
	write() {}
	resize() {}
	kill() {}
	pause() {}
	resume() {}
	dispose() {
		this.disposed = true;
	}
	getMasterFd() {
		return -1;
	}
	onData(callback: PtyOnData) {
		this.onOutput = callback;
	}
	onExit(callback: PtyOnExit) {
		this.onEnd = callback;
	}
	emit(bytes: Buffer) {
		this.onOutput(bytes);
	}
	finish(code: number) {
		this.onEnd({ code, signal: null });
	}
}

let server: Server | undefined;
afterEach(async () => {
	await server?.close();
	server = undefined;
});

test("an exit before subscription still replays output and completion without keeping an active session", async () => {
	const socketPath = join(tmpdir(), `lifecycle-${randomUUID()}.sock`);
	let spawned: CompletingPty | undefined;
	server = new Server({
		socketPath,
		daemonVersion: "test",
		spawnPty: ({ meta }) => {
			spawned = new CompletingPty(meta);
			return spawned;
		},
	});
	await server.listen();
	const client = await connectAndHello(socketPath);
	try {
		client.send({
			type: "open",
			id: "instant",
			meta: { shell: "/bin/sh", argv: [], cols: 80, rows: 24 },
		});
		await client.waitFor((m) => m.type === "open-ok");
		if (!spawned) throw new Error("missing PTY");
		spawned.emit(Buffer.from("quick command output"));
		spawned.finish(23);
		expect(spawned.disposed).toBe(true);
		client.send({ type: "list" });
		const list = await client.waitFor((m) => m.type === "list-reply");
		if (list.type !== "list-reply") throw new Error("missing list");
		expect(list.sessions).toEqual([]);
		client.send({ type: "subscribe", id: "instant", replay: true });
		const completion = await client.waitFor(
			(m) => m.type === "exit" || m.type === "error",
		);
		expect(completion).toEqual({
			type: "exit",
			id: "instant",
			code: 23,
			signal: null,
		});
		expect(accumulatedOutputAsString(client, "instant")).toBe(
			"quick command output",
		);
		client.send({ type: "input", id: "instant" }, Buffer.from("unsafe"));
		const inputReply = await client.waitFor((m) => m.type === "error");
		expect(inputReply).toMatchObject({ code: "ENOENT" });
	} finally {
		await client.close();
	}
});

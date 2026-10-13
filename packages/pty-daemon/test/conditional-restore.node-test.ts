import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Server } from "../src/Server/Server.ts";
import { connectAndHello, accumulatedOutputAsString } from "./helpers/client.ts";

test("a real replacement PTY rejects stale subscription, input and resize without receiving input", async () => {
	const root = await mkdtemp(join(tmpdir(), "pty-restore-"));
	const socketPath = join(root, "daemon.sock");
	const server = new Server({ socketPath, daemonVersion: "restore-test" });
	await server.listen();
	const owner = await connectAndHello(socketPath);
	const stale = await connectAndHello(socketPath);
	try {
		const meta = { shell: "/bin/sh", argv: ["-c", "exec cat"], cols: 80, rows: 24 };
		owner.send({ type: "open", id: "terminal", meta });
		const original = await owner.waitFor((m) => m.type === "open-ok");
		assert.equal(original.type, "open-ok");
		if (original.type !== "open-ok") throw new Error("Missing original execution");
		assert.ok(original.executionId);
		stale.send({ type: "subscribe", id: "terminal", executionId: original.executionId, replay: true });
		await stale.waitFor((m) => m.type === "subscribed");
		owner.send({ type: "close", id: "terminal", signal: "SIGKILL" });
		await owner.waitFor((m) => m.type === "closed");
		const opened = owner.waitForNext((m) => m.type === "open-ok");
		owner.send({ type: "open", id: "terminal", meta });
		const replacement = await opened;
		if (replacement.type !== "open-ok") throw new Error("Missing replacement execution");
		assert.notEqual(replacement.executionId, original.executionId);
		const reject = async (message: unknown, payload?: Uint8Array) => {
			const rejected = stale.waitForNext((m) => m.type === "error");
			stale.send(message, payload);
			const result = await rejected;
			assert.equal(result.type === "error" ? result.code : null, "EEXECUTION");
		};
		await reject({ type: "subscribe", id: "terminal", executionId: original.executionId, replay: true });
		await reject({ type: "input", id: "terminal", executionId: original.executionId }, Buffer.from("UNSAFE_RESTORED_INPUT\n"));
		await reject({ type: "resize", id: "terminal", executionId: original.executionId, cols: 12, rows: 10 });
		owner.send({ type: "subscribe", id: "terminal", executionId: replacement.executionId, replay: true });
		await owner.waitFor((m) => m.type === "subscribed");
		owner.send({ type: "input", id: "terminal", executionId: replacement.executionId }, Buffer.from("SAFE_PROBE\n"));
		await owner.waitFor((m) => m.type === "output" && accumulatedOutputAsString(owner, "terminal").includes("SAFE_PROBE"));
		assert.equal(accumulatedOutputAsString(owner, "terminal").includes("UNSAFE_RESTORED_INPUT"), false);
		const listed = owner.waitForNext((m) => m.type === "list-reply");
		owner.send({ type: "list" });
		const list = await listed;
		if (list.type !== "list-reply") throw new Error("Missing list");
		assert.equal(list.sessions[0]?.executionId, replacement.executionId);
		assert.equal(list.sessions[0]?.cols, 80);
	} finally {
		await owner.close(); await stale.close(); await server.close();
		await rm(root, { recursive: true, force: true });
	}
});

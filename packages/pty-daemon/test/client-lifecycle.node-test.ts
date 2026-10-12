import { strict as assert } from "node:assert";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { connect, type DaemonClient } from "./helpers/client.ts";

test("peer closure rejects pending protocol work before its response deadline", async () => {
	const directory = await mkdtemp(join(tmpdir(), "pty-client-lifecycle-"));
	const socketPath = join(directory, "daemon.sock");
	let peer: Socket | undefined;
	const server = createServer((socket) => {
		peer = socket;
	});
	let client: DaemonClient | undefined;
	try {
		await new Promise<void>((resolve, reject) => {
			server.once("error", reject);
			server.listen(socketPath, resolve);
		});
		client = await connect(socketPath);
		if (!peer) throw new Error("missing server connection");
		const pending = client.waitFor((m) => m.type === "list-reply", 1000);
		peer.destroy();
		await assert.rejects(pending, /Daemon connection closed/);
	} finally {
		peer?.destroy();
		await client?.close();
		await new Promise<void>((resolve) => server.close(() => resolve()));
		await rm(directory, { recursive: true, force: true });
	}
});

import assert from "node:assert/strict";
import {
	chmodSync,
	lstatSync,
	mkdtempSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { createServer, request } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { directBackendSocketPath } from "@superset/shared/direct-backend-socket";
import { listenDirectSocket } from "./unix-listener";

test("the direct HTTP socket is private to its backend owner and serves authenticated requests", async () => {
	const home = mkdtempSync(join(tmpdir(), "direct-socket-"));
	const identity = {
		homeDir: home,
		backendId: "backend",
		namespaceId: "namespace",
		uid: process.getuid!(),
	};
	const server = createServer((incoming, response) => {
		response.writeHead(
			incoming.headers.authorization === "Bearer secret" ? 200 : 401,
		);
		response.end("direct");
	});
	try {
		const socketPath = await listenDirectSocket(server, identity);
		assert.equal(socketPath, directBackendSocketPath(identity));
		assert.equal(lstatSync(socketPath).mode & 0o777, 0o600);
		assert.equal(lstatSync(dirname(socketPath)).mode & 0o777, 0o700);
		const status = await new Promise<number>((resolve, reject) => {
			const client = request(
				{
					socketPath,
					path: "/direct/describe",
					headers: { authorization: "Bearer secret" },
				},
				(response) => {
					response.resume();
					response.once("end", () => resolve(response.statusCode!));
				},
			);
			client.once("error", reject);
			client.end();
		});
		assert.equal(status, 200);
	} finally {
		if (server.listening)
			await new Promise<void>((resolve) => server.close(() => resolve()));
		rmSync(home, { recursive: true, force: true });
		rmSync(dirname(directBackendSocketPath(identity)), {
			recursive: true,
			force: true,
		});
	}
});

test("a shared backend directory or an existing non-socket is rejected before listening", async () => {
	const home = mkdtempSync(join(tmpdir(), "direct-socket-unsafe-"));
	const identity = {
		homeDir: home,
		backendId: "backend",
		namespaceId: "namespace",
		uid: process.getuid!(),
	};
	const server = createServer();
	try {
		chmodSync(home, 0o777);
		await assert.rejects(
			listenDirectSocket(server, identity),
			/private.*directory/,
		);
		chmodSync(home, 0o700);
		const path = await listenDirectSocket(server, identity);
		await new Promise<void>((resolve) => server.close(() => resolve()));
		writeFileSync(path, "untrusted replacement", { mode: 0o600 });
		await assert.rejects(listenDirectSocket(server, identity), /socket/);
		assert.equal(server.listening, false);
	} finally {
		if (server.listening) server.close();
		rmSync(home, { recursive: true, force: true });
		rmSync(dirname(directBackendSocketPath(identity)), {
			recursive: true,
			force: true,
		});
	}
});

import { afterEach, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { privateSocketFetch, startPrivateSocketProxy } from "./local-socket";

const servers: Server[] = [];
const directories: string[] = [];
afterEach(async () => {
	for (const server of servers.splice(0))
		await new Promise<void>((resolve) => server.close(() => resolve()));
	for (const directory of directories.splice(0))
		rmSync(directory, { recursive: true, force: true });
});

test("a credentialed local request reaches only the private Unix socket", async () => {
	const directory = mkdtempSync(join(tmpdir(), "private-socket-"));
	directories.push(directory);
	const socket = join(directory, "control.sock");
	const privateServer = createServer((request, response) => {
		response.end(request.headers.authorization);
	});
	servers.push(privateServer);
	await new Promise<void>((resolve) => privateServer.listen(socket, resolve));
	chmodSync(socket, 0o600);
	let leakedRequests = 0;
	const foreign = createServer((_request, response) => {
		leakedRequests++;
		response.end("foreign owner");
	});
	servers.push(foreign);
	await new Promise<void>((resolve) => foreign.listen(0, "127.0.0.1", resolve));
	const address = foreign.address();
	if (!address || typeof address === "string")
		throw new Error("Expected an allocated TCP port");
	const result = await privateSocketFetch(
		socket,
		`http://127.0.0.1:${address.port}/direct/describe`,
		{ headers: { Authorization: "Bearer private-secret" } },
	);
	expect(await result.text()).toBe("Bearer private-secret");
	expect(leakedRequests).toBe(0);
	chmodSync(directory, 0o777);
	await expect(
		privateSocketFetch(socket, "/direct/describe", {
			headers: { Authorization: "Bearer private-secret" },
		}),
	).rejects.toThrow("private directory");
	expect(leakedRequests).toBe(0);
});

test("the owned proxy never sends credentials to a reused backend TCP port", async () => {
	const directory = mkdtempSync(join(tmpdir(), "private-proxy-"));
	directories.push(directory);
	const socket = join(directory, "control.sock");
	const backend = createServer((_request, response) =>
		response.end("owned backend"),
	);
	servers.push(backend);
	await new Promise<void>((resolve) => backend.listen(socket, resolve));
	chmodSync(socket, 0o600);
	let foreignRequests = 0;
	const foreign = createServer((_request, response) => {
		foreignRequests++;
		response.end("reused old TCP port");
	});
	servers.push(foreign);
	await new Promise<void>((resolve) => foreign.listen(0, "127.0.0.1", resolve));
	const proxy = await startPrivateSocketProxy(socket);
	try {
		expect(
			await (
				await fetch(proxy.url, {
					headers: { Authorization: "Bearer private-secret" },
				})
			).text(),
		).toBe("owned backend");
		backend.closeAllConnections();
		await new Promise<void>((resolve) => backend.close(() => resolve()));
		await expect(
			fetch(proxy.url, { headers: { Authorization: "Bearer private-secret" } }),
		).rejects.toThrow();
		expect(foreignRequests).toBe(0);
	} finally {
		proxy.close();
	}
});

import { lstatSync } from "node:fs";
import { request } from "node:http";
import { connect, createServer, type Socket } from "node:net";
import { dirname, isAbsolute } from "node:path";

export function assertPrivateSocket(socketPath: string): void {
	if (!isAbsolute(socketPath) || Buffer.byteLength(socketPath) >= 104)
		throw new Error("A private backend socket path is required");
	const directory = lstatSync(dirname(socketPath));
	const socket = lstatSync(socketPath);
	if (
		!directory.isDirectory() ||
		directory.isSymbolicLink() ||
		(directory.mode & 0o077) !== 0 ||
		!socket.isSocket() ||
		socket.isSymbolicLink() ||
		(socket.mode & 0o077) !== 0 ||
		(process.getuid &&
			(directory.uid !== process.getuid() || socket.uid !== process.getuid()))
	)
		throw new Error(
			"The backend socket must belong to the ordinary service user in a private directory",
		);
}

export async function privateSocketFetch(
	socketPath: string,
	target: string,
	init: RequestInit = {},
): Promise<Response> {
	assertPrivateSocket(socketPath);
	const url = new URL(target, "http://localhost");
	const headers = Object.fromEntries(new Headers(init.headers));
	let body: string | Uint8Array | undefined;
	if (typeof init.body === "string") body = init.body;
	else if (init.body instanceof Uint8Array) body = init.body;
	else if (init.body instanceof ArrayBuffer) body = new Uint8Array(init.body);
	else if (init.body != null)
		throw new Error("Unsupported private backend request body");
	return new Promise((resolve, reject) => {
		const operation = request(
			{
				socketPath,
				path: `${url.pathname}${url.search}`,
				method: init.method ?? "GET",
				headers,
				signal: init.signal ?? undefined,
			},
			(response) => {
				const chunks: Buffer[] = [];
				let bytes = 0;
				response.on("data", (chunk: Buffer) => {
					bytes += chunk.length;
					if (bytes > 32 * 1024 * 1024) {
						response.destroy(
							new Error("The private backend response exceeded 32 MiB"),
						);
						return;
					}
					chunks.push(chunk);
				});
				response.once("error", reject);
				response.once("end", () => {
					const status = response.statusCode ?? 500;
					if (init.redirect === "error" && status >= 300 && status < 400) {
						reject(new Error("Private backend redirects are not allowed"));
						return;
					}
					const responseHeaders = new Headers();
					for (const [key, value] of Object.entries(response.headers)) {
						if (Array.isArray(value))
							for (const item of value) responseHeaders.append(key, item);
						else if (value !== undefined) responseHeaders.set(key, value);
					}
					resolve(
						new Response(
							[204, 205, 304].includes(status) ? null : Buffer.concat(chunks),
							{ status, headers: responseHeaders },
						),
					);
				});
			},
		);
		operation.once("error", reject);
		operation.end(body);
	});
}

export function startPrivateSocketProxy(
	socketPath: string,
): Promise<{ url: string; close(): void }> {
	assertPrivateSocket(socketPath);
	return new Promise((resolve, reject) => {
		const sockets = new Set<Socket>();
		let closed = false;
		const server = createServer((client) => {
			if (sockets.size >= 128) {
				client.destroy();
				return;
			}
			try {
				assertPrivateSocket(socketPath);
			} catch {
				client.destroy();
				return;
			}
			const backend = connect({ path: socketPath });
			sockets.add(client);
			sockets.add(backend);
			client.once("error", () => backend.destroy());
			backend.once("error", () => client.destroy());
			client.once("close", () => {
				sockets.delete(client);
				backend.destroy();
			});
			backend.once("close", () => {
				sockets.delete(backend);
				client.destroy();
			});
			client.pipe(backend).pipe(client);
		});
		server.once("error", reject);
		server.listen(0, "127.0.0.1", () => {
			const address = server.address();
			if (!address || typeof address === "string") {
				server.close();
				reject(new Error("Could not allocate the owned local proxy"));
				return;
			}
			server.unref();
			resolve({
				url: `http://127.0.0.1:${address.port}`,
				close() {
					if (closed) return;
					closed = true;
					for (const socket of sockets) socket.destroy();
					sockets.clear();
					server.close();
				},
			});
		});
	});
}

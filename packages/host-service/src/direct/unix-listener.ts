import {
	chmodSync,
	lstatSync,
	mkdirSync,
	type Stats,
	unlinkSync,
} from "node:fs";
import type { Server } from "node:http";
import { createConnection } from "node:net";
import { dirname } from "node:path";
import {
	type DirectSocketIdentity,
	directBackendSocketPath,
} from "@superset/shared/direct-backend-socket";

function assertPrivateDirectory(path: string): void {
	const stat = lstatSync(path);
	if (
		!stat.isDirectory() ||
		stat.uid !== process.getuid?.() ||
		(stat.mode & 0o077) !== 0
	)
		throw new Error(
			"The backend socket must be inside a private owner-only directory",
		);
}

export function assertDirectSocket(
	identity: {
		homeDir: string;
		backendId: string;
		namespaceId: string;
		serviceUid: number;
	},
	socketPath: string,
): void {
	if (
		socketPath !==
		directBackendSocketPath({ ...identity, uid: identity.serviceUid })
	)
		throw new Error("Unexpected direct backend socket path");
	assertPrivateDirectory(identity.homeDir);
	assertPrivateDirectory(dirname(socketPath));
	const stat = lstatSync(socketPath);
	if (
		!stat.isSocket() ||
		stat.uid !== process.getuid?.() ||
		(stat.mode & 0o777) !== 0o600
	)
		throw new Error(
			"The backend socket must be an owner-only socket owned by the service user",
		);
}

async function socketIsListening(path: string): Promise<boolean> {
	return new Promise((resolve, reject) => {
		const socket = createConnection(path);
		socket.setTimeout(1000, () => {
			socket.destroy();
			reject(new Error("The existing backend socket cannot be verified"));
		});
		socket.once("connect", () => {
			socket.destroy();
			resolve(true);
		});
		socket.once("error", (error: NodeJS.ErrnoException) => {
			socket.destroy();
			if (error.code === "ECONNREFUSED" || error.code === "ENOENT")
				resolve(false);
			else reject(error);
		});
	});
}

export async function listenDirectSocket(
	server: Server,
	identity: DirectSocketIdentity,
): Promise<string> {
	if (identity.uid !== process.getuid?.())
		throw new Error("The direct socket identity must match its service user");
	assertPrivateDirectory(identity.homeDir);
	const path = directBackendSocketPath(identity);
	const state = dirname(path);
	try {
		mkdirSync(state, { mode: 0o700 });
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
	}
	assertPrivateDirectory(state);
	let existing: Stats | undefined;
	try {
		existing = lstatSync(path);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
	}
	if (existing) {
		if (
			!existing.isSocket() ||
			existing.uid !== process.getuid?.() ||
			(existing.mode & 0o077) !== 0
		)
			throw new Error(
				"The existing backend socket must be owned by the service user",
			);
		if (await socketIsListening(path))
			throw new Error("A backend is already listening on its private socket");
		unlinkSync(path);
	}
	await new Promise<void>((resolve, reject) => {
		server.once("error", reject);
		server.listen(path, () => {
			server.off("error", reject);
			try {
				chmodSync(path, 0o600);
				resolve();
			} catch (error) {
				server.close();
				reject(error);
			}
		});
	});
	return path;
}

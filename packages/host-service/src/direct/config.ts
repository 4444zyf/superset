import { randomUUID } from "node:crypto";
import {
	closeSync,
	constants,
	fstatSync,
	mkdirSync,
	openSync,
	readSync,
	renameSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import {
	type DirectConfig,
	directConfigSchema,
} from "@superset/shared/direct-backend-config";
import { assertDirectSocket } from "./unix-listener";

export {
	type DirectConfig,
	directConfigSchema,
} from "@superset/shared/direct-backend-config";
export interface DirectEndpoint {
	socketPath?: string;
	backendId: string;
	namespaceId: string;
	instanceId: string;
	port: number;
	serviceUid: number;
	runtimeMode: "direct";
	protocolVersion: 1;
}

export function loadDirectConfig(path: string): DirectConfig {
	return directConfigSchema.parse(
		JSON.parse(readPrivateRegularFile(path, 65536, "configuration")),
	);
}

function readPrivateRegularFile(
	path: string,
	maximumBytes: number,
	kind: string,
): string {
	const fd = openSync(
		path,
		constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
	);
	try {
		const stat = fstatSync(fd);
		if (
			!stat.isFile() ||
			(stat.mode & 0o077) !== 0 ||
			(process.getuid && stat.uid !== process.getuid())
		) {
			throw new Error(
				`The backend ${kind} must be an owner-only regular file owned by the service user`,
			);
		}
		if (stat.size > maximumBytes)
			throw new Error(`The backend ${kind} exceeds its size limit`);
		const bytes = Buffer.alloc(maximumBytes + 1);
		let length = 0;
		while (length < bytes.length) {
			const count = readSync(fd, bytes, length, bytes.length - length, length);
			if (count === 0) break;
			length += count;
		}
		if (length > maximumBytes)
			throw new Error(`The backend ${kind} exceeds its size limit`);
		return bytes.subarray(0, length).toString("utf8");
	} finally {
		closeSync(fd);
	}
}

export function readDirectSecret(path: string): string {
	const secret = readPrivateRegularFile(path, 1024, "secret").trim();
	if (!/^[a-f0-9]{64}$/.test(secret))
		throw new Error("Expected a 32-byte hexadecimal backend secret");
	return secret;
}

export function publishDirectEndpoint(
	homeDir: string,
	endpoint: DirectEndpoint,
): string {
	if (endpoint.socketPath)
		assertDirectSocket({ homeDir, ...endpoint }, endpoint.socketPath);
	const path = join(homeDir, "state", "endpoint.json");
	mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
	const temporary = `${path}.${randomUUID()}.tmp`;
	try {
		writeFileSync(temporary, `${JSON.stringify(endpoint)}\n`, {
			mode: 0o600,
			flag: "wx",
		});
		renameSync(temporary, path);
	} finally {
		try {
			unlinkSync(temporary);
		} catch {}
	}
	return path;
}

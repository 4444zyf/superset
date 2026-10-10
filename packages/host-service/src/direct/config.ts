import { randomUUID } from "node:crypto";
import {
	closeSync,
	constants,
	fstatSync,
	mkdirSync,
	openSync,
	readFileSync,
	renameSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import { z } from "zod";
import { assertDirectSocket } from "./unix-listener";

const absolutePath = z
	.string()
	.min(1)
	.refine(isAbsolute, "Expected an absolute path");
export const directConfigSchema = z
	.object({
		backendId: z.string().uuid(),
		namespaceId: z.string().uuid(),
		homeDir: absolutePath,
		secretFile: absolutePath,
		migrationsFolder: absolutePath,
		chatMigrationsFolder: absolutePath.optional(),
		hostServicePath: absolutePath.optional(),
		allowedOrigins: z.array(z.string()).default([]),
		installationMode: z.enum(["local", "managed"]).optional(),
	})
	.strict();

export type DirectConfig = z.infer<typeof directConfigSchema>;
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
	return directConfigSchema.parse(JSON.parse(readFileSync(path, "utf8")));
}

export function readDirectSecret(path: string): string {
	const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
	try {
		const stat = fstatSync(fd);
		if (
			!stat.isFile() ||
			(stat.mode & 0o077) !== 0 ||
			(process.getuid && stat.uid !== process.getuid())
		) {
			throw new Error(
				"The backend secret must be an owner-only regular file owned by the service user",
			);
		}
		const secret = readFileSync(fd, "utf8").trim();
		if (!/^[a-f0-9]{64}$/.test(secret))
			throw new Error("Expected a 32-byte hexadecimal backend secret");
		return secret;
	} finally {
		closeSync(fd);
	}
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

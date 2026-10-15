import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { getMetadata, readFile, writeFile } from "@superset/workspace-fs/host";
import { TRPCError } from "@trpc/server";
import { getProjectConfigPath } from "../../../runtime/setup/config";

const MAX_CONFIG_BYTES = 512 * 1024;
export interface ProjectScripts {
	setup: string[];
	teardown: string[];
	run: string[];
}

function parse(content: string | null): Record<string, unknown> {
	if (content === null) return {};
	try {
		const value = JSON.parse(content);
		if (!value || typeof value !== "object" || Array.isArray(value))
			throw new Error();
		for (const key of ["setup", "teardown", "run"]) {
			if (
				value[key] !== undefined &&
				(!Array.isArray(value[key]) ||
					value[key].some((item: unknown) => typeof item !== "string"))
			)
				throw new Error();
		}
		return value;
	} catch {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message:
				"The project config must be a JSON object with script arrays. Repair the file before editing scripts.",
		});
	}
}

async function validateDirectory(path: string) {
	const directory = await getMetadata({ absolutePath: dirname(path) });
	if (directory && directory.kind !== "directory")
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: "The project config directory must be a regular directory.",
		});
}

export async function readProjectScripts(repoPath: string) {
	const path = getProjectConfigPath(repoPath);
	await validateDirectory(path);
	const metadata = await getMetadata({ absolutePath: path });
	let content: string | null = null;
	let revision: string | null = null;
	if (metadata) {
		if (
			metadata.kind !== "file" ||
			metadata.size === null ||
			metadata.size > MAX_CONFIG_BYTES
		)
			throw new TRPCError({
				code: "BAD_REQUEST",
				message:
					"The project config must be a regular file no larger than 512 KiB.",
			});
		const result = await readFile({
			rootPath: repoPath,
			absolutePath: path,
			maxBytes: MAX_CONFIG_BYTES,
			encoding: "utf8",
		});
		if (result.kind !== "text" || result.exceededLimit)
			throw new TRPCError({
				code: "BAD_REQUEST",
				message: "The project config exceeds its size limit.",
			});
		content = result.content;
		revision = result.revision;
	}
	const parsed = parse(content);
	const scripts: ProjectScripts = {
		setup: (parsed.setup ?? []) as string[],
		teardown: (parsed.teardown ?? []) as string[],
		run: (parsed.run ?? []) as string[],
	};
	return { content, revision, scripts };
}

export async function writeProjectScripts(
	repoPath: string,
	input: ProjectScripts & { expectedRevision: string | null },
) {
	const current = await readProjectScripts(repoPath);
	if (current.revision !== input.expectedRevision)
		throw new TRPCError({
			code: "CONFLICT",
			message: "The project config changed. Refresh before saving again.",
		});
	const path = getProjectConfigPath(repoPath);
	const content = JSON.stringify(
		{
			...parse(current.content),
			setup: input.setup,
			teardown: input.teardown,
			run: input.run,
		},
		null,
		2,
	);
	if (Buffer.byteLength(content) > MAX_CONFIG_BYTES)
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: "The project config exceeds its size limit.",
		});
	try {
		await mkdir(dirname(path));
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
	}
	await validateDirectory(path);
	const result = await writeFile({
		absolutePath: path,
		content,
		encoding: "utf8",
		options:
			current.revision === null
				? { create: true, overwrite: false }
				: { create: false, overwrite: true },
		...(current.revision === null
			? {}
			: { precondition: { ifMatch: current.revision } }),
	});
	if (!result.ok)
		throw new TRPCError({
			code: "CONFLICT",
			message: "The project config changed. Refresh before saving again.",
		});
	return readProjectScripts(repoPath);
}

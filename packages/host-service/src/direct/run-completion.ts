import { createHash } from "node:crypto";
import {
	closeSync,
	constants,
	fstatSync,
	lstatSync,
	mkdirSync,
	openSync,
	readSync,
	rmSync,
} from "node:fs";
import { basename, join } from "node:path";
import { shellSingleQuote } from "../runtime/setup/config";

export function supportsRunCompletion(shell: string): boolean {
	return ["bash", "zsh", "sh", "dash", "ksh", "mksh"].includes(basename(shell));
}
type Scope = { workspaceId: string; operationId: string };
export class RunCompletionStore {
	constructor(private readonly root: string) {}
	private directory(workspaceId: string): string {
		return join(
			this.root,
			createHash("sha256").update(workspaceId).digest("hex"),
		);
	}
	private assertDirectory(path: string): void {
		const stat = lstatSync(path);
		if (
			!stat.isDirectory() ||
			(stat.mode & 0o077) !== 0 ||
			(process.getuid && stat.uid !== process.getuid())
		)
			throw new Error(
				"Run completion directory must be private and owned by the service user",
			);
	}
	prepare(run: Scope, shell: string, command: string): string {
		if (!supportsRunCompletion(shell))
			throw new Error("Run completion is unavailable for this shell");
		if (!/^[\w-]{1,128}$/.test(run.operationId))
			throw new Error("Invalid run operation ID");
		const directory = this.directory(run.workspaceId);
		mkdirSync(this.root, { recursive: true, mode: 0o700 });
		this.assertDirectory(this.root);
		mkdirSync(directory, { mode: 0o700, recursive: true });
		this.assertDirectory(directory);
		const temp = join(directory, "result.tmp"),
			result = join(directory, "result");
		rmSync(temp, { force: true });
		return `{
eval ${shellSingleQuote(" " + command)}
_superset_run_status=$?
(
umask 077
set -C
command printf '%s\\n%s\\n' ${shellSingleQuote(run.operationId)} "$_superset_run_status" > ${shellSingleQuote(temp)} && command mv -f ${shellSingleQuote(temp)} ${shellSingleQuote(result)}
command /bin/sh -c 'exit "$1"' -- "$_superset_run_status"
)
}`;
	}
	read(run: Scope): number | null {
		let fd: number | undefined;
		try {
			this.assertDirectory(this.root);
			const directory = this.directory(run.workspaceId);
			this.assertDirectory(directory);
			fd = openSync(
				join(directory, "result"),
				constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
			);
			const stat = fstatSync(fd);
			if (
				!stat.isFile() ||
				stat.size > 256 ||
				(stat.mode & 0o077) !== 0 ||
				(process.getuid && stat.uid !== process.getuid())
			)
				throw new Error(
					"Run completion must be a bounded private regular file",
				);
			const bytes = Buffer.alloc(257);
			const count = readSync(fd, bytes, 0, bytes.length, 0);
			const content = bytes.subarray(0, count).toString("utf8");
			const parts = content.split("\n");
			if (parts.length !== 3) return null;
			const [operationId, code, tail] = parts;
			if (
				operationId !== run.operationId ||
				tail !== "" ||
				!/^\d{1,3}$/.test(code ?? "")
			)
				return null;
			const exitCode = Number(code);
			return exitCode <= 255 ? exitCode : null;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
			throw error;
		} finally {
			if (fd !== undefined) closeSync(fd);
		}
	}
	remove(workspaceId: string): void {
		try {
			this.assertDirectory(this.root);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
			throw error;
		}
		rmSync(this.directory(workspaceId), { recursive: true, force: true });
	}
}

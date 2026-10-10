// biome-ignore lint/style/noRestrictedImports: The installer isolates mutable upload reads in a dedicated UID process.
import { execFileSync } from "node:child_process";

export function readIncomingPayload(input: {
	path: string;
	size: number;
	uid: number;
	gid: number;
	userHome: string;
	timeoutMs?: number;
}): Buffer {
	return execFileSync(
		"/usr/bin/head",
		["-c", String(input.size + 1), input.path],
		{
			uid: input.uid,
			gid: input.gid,
			maxBuffer: input.size + 2,
			timeout: input.timeoutMs ?? 30_000,
			killSignal: "SIGKILL",
			env: { HOME: input.userHome, PATH: "/usr/bin:/bin" },
		},
	);
}

import { spawn as spawnProcess } from "node:child_process";
import { StringDecoder } from "node:string_decoder";

/** Keep lifecycle ownership until close, including timeout and output-overflow cleanup. */
export function runLocalImportProcess(options: {
	executable: string;
	args: string[];
	cwd: string;
	environment: NodeJS.ProcessEnv;
	spawn?: typeof spawnProcess;
	timeoutMs?: number;
	graceMs?: number;
	maxOutputBytes?: number;
}): Promise<string> {
	const maxOutputBytes = options.maxOutputBytes ?? 64 * 1024;
	if (
		!Number.isSafeInteger(maxOutputBytes) ||
		maxOutputBytes < 1 ||
		maxOutputBytes > 1024 * 1024
	)
		throw new Error("Invalid local response byte limit");
	return new Promise((resolve, reject) => {
		const child = (options.spawn ?? spawnProcess)(
			options.executable,
			options.args,
			{
				stdio: ["ignore", "pipe", "pipe"],
				cwd: options.cwd,
				env: options.environment,
			},
		);
		let stdout = "",
			stderr = "",
			stdoutBytes = 0,
			stderrBytes = 0;
		const stdoutDecoder = new StringDecoder("utf8"),
			stderrDecoder = new StringDecoder("utf8");
		let failure: Error | undefined,
			settled = false;
		let escalation: ReturnType<typeof setTimeout> | undefined;
		const clear = () => {
			clearTimeout(deadline);
			if (escalation) clearTimeout(escalation);
		};
		const stop = (error: Error) => {
			if (failure || settled) return;
			failure = error;
			clearTimeout(deadline);
			child.stdout?.destroy();
			child.stderr?.destroy();
			escalation = setTimeout(() => {
				if (!settled) child.kill("SIGKILL");
			}, options.graceMs ?? 500);
			child.kill("SIGTERM");
		};
		const deadline = setTimeout(
			() =>
				stop(
					new Error(
						"The offline import timed out; its journal will recover on the next import",
					),
				),
			options.timeoutMs ?? 120000,
		);
		child.stdout?.on("data", (chunk: Buffer) => {
			if (failure || settled) return;
			stdoutBytes += chunk.length;
			if (stdoutBytes > maxOutputBytes) {
				stop(new Error("The local importer returned an invalid response"));
				return;
			}
			stdout += stdoutDecoder.write(chunk);
		});
		child.stderr?.on("data", (chunk: Buffer) => {
			if (failure || settled) return;
			const remaining = 16 * 1024 - stderrBytes;
			if (remaining > 0) {
				const bounded = chunk.subarray(0, remaining);
				stderrBytes += bounded.length;
				stderr += stderrDecoder.write(bounded);
			}
		});
		child.once("error", (error) => {
			if (settled) return;
			if (!child.pid) {
				settled = true;
				clear();
				reject(error);
			} else stop(error);
		});
		child.once("close", (code) => {
			if (settled) return;
			settled = true;
			clear();
			stdout += stdoutDecoder.end();
			stderr += stderrDecoder.end();
			if (failure) reject(failure);
			else if (code !== 0)
				reject(
					new Error(
						stderr.trim() ||
							"The offline import failed; source data was preserved",
					),
				);
			else resolve(stdout);
		});
	});
}

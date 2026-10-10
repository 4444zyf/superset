import {
	type ChildProcess,
	type ChildProcessWithoutNullStreams,
	spawn,
} from "node:child_process";

interface SshProcessOptions {
	stdio: "pipe" | "ignore";
	cleanupDirectory?: string;
	execPath?: string;
	pollIntervalMs?: number;
	gracePeriodMs?: number;
}

const watchdogSource = `
const { spawn } = require("node:child_process");
const { rmSync } = require("node:fs");
const config = JSON.parse(process.argv[1]);
let child;
let stopping = false;
let finished = false;
let poll;
let grace;
function signalOwnedGroup(signal) {
  if (!child || !child.pid) return;
  try {
    if (process.platform === "win32") child.kill(signal);
    else process.kill(-child.pid, signal);
  } catch (error) {
    if (error.code !== "ESRCH") throw error;
  }
}
function finish(code) {
  if (finished) return;
  finished = true;
  clearInterval(poll);
  clearTimeout(grace);
  signalOwnedGroup("SIGKILL");
  if (config.cleanupDirectory) {
    try { rmSync(config.cleanupDirectory, { recursive: true, force: true }); } catch {}
  }
  process.exit(code);
}
function stop() {
  if (stopping || finished) return;
  stopping = true;
  signalOwnedGroup("SIGTERM");
  grace = setTimeout(() => signalOwnedGroup("SIGKILL"), config.gracePeriodMs);
}
function parentAlive() {
  if (process.ppid !== config.parentPid) return false;
  try { process.kill(config.parentPid, 0); return true; } catch { return false; }
}
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
process.on("SIGHUP", stop);
if (!parentAlive()) finish(255);
child = spawn(config.program, config.args, {
  stdio: "inherit", detached: process.platform !== "win32", windowsHide: true, shell: false
});
child.once("error", () => finish(255));
child.once("close", (code) => finish(code === null ? 255 : code));
poll = setInterval(() => { if (!parentAlive()) stop(); }, config.pollIntervalMs);
`;

export function spawnOwnedSsh(
	program: string,
	args: string[],
	options: SshProcessOptions & { stdio: "pipe" },
): ChildProcessWithoutNullStreams;
export function spawnOwnedSsh(
	program: string,
	args: string[],
	options: SshProcessOptions,
): ChildProcess;
export function spawnOwnedSsh(
	program: string,
	args: string[],
	options: SshProcessOptions,
): ChildProcess {
	const environment: NodeJS.ProcessEnv = {
		...process.env,
		ELECTRON_RUN_AS_NODE: "1",
	};
	delete environment.NODE_OPTIONS;
	delete environment.NODE_PATH;
	return spawn(
		options.execPath ?? process.execPath,
		[
			"-e",
			watchdogSource,
			"--",
			JSON.stringify({
				program,
				args,
				parentPid: process.pid,
				cleanupDirectory: options.cleanupDirectory,
				pollIntervalMs: options.pollIntervalMs ?? 250,
				gracePeriodMs: options.gracePeriodMs ?? 1000,
			}),
		],
		{
			stdio: options.stdio,
			env: environment,
			detached: process.platform !== "win32",
			windowsHide: true,
			shell: false,
		},
	);
}

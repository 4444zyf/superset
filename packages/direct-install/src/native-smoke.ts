import { createRequire } from "node:module";
import { homedir } from "node:os";

interface SmokePty {
	onExit(callback: (exit: { exitCode: number }) => void): { dispose(): void };
	kill(): void;
}
interface SmokeDependencies {
	load(name: string): unknown;
	timeoutMs?: number;
}
export async function runNativeSmoke(
	dependencies: SmokeDependencies = { load: createRequire(import.meta.url) },
): Promise<void> {
	const Database = dependencies.load("better-sqlite3") as new (
		path: string,
	) => { close(): void };
	const database = new Database(":memory:");
	database.close();
	const watcher = dependencies.load("@parcel/watcher") as {
		subscribe: unknown;
	};
	if (typeof watcher.subscribe !== "function")
		throw new Error("The native file watcher could not load");
	const pty = dependencies.load("node-pty") as {
		spawn(
			command: string,
			args: string[],
			options: Record<string, unknown>,
		): SmokePty;
	};
	const terminal = pty.spawn("/bin/sh", ["-c", "exit 0"], {
		name: "xterm-256color",
		cols: 80,
		rows: 24,
		cwd: homedir(),
		env: { HOME: homedir(), PATH: "/usr/bin:/bin", TERM: "xterm-256color" },
	});
	await new Promise<void>((resolve, reject) => {
		const timer = setTimeout(() => {
			terminal.kill();
			reject(new Error("The native PTY smoke check did not exit"));
		}, dependencies.timeoutMs ?? 2000);
		terminal.onExit((exit) => {
			clearTimeout(timer);
			if (exit.exitCode === 0) resolve();
			else reject(new Error("The native PTY smoke check failed"));
		});
	});
}

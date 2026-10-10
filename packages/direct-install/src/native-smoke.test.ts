import { expect, test } from "bun:test";
import { runNativeSmoke } from "./native-smoke";

test("checks database and watcher modules and invokes the PTY smoke command through its runtime loader", async () => {
	const loaded: string[] = [];
	let closed = false;
	let pty = false;
	await runNativeSmoke({
		load(name) {
			loaded.push(name);
			if (name === "better-sqlite3")
				return class {
					close() {
						closed = true;
					}
				};
			if (name === "@parcel/watcher") return { subscribe() {} };
			return {
				spawn(command: string, args: string[]) {
					pty = command === "/bin/sh" && args.join(" ") === "-c exit 0";
					return {
						onExit(callback: (exit: { exitCode: number }) => void) {
							queueMicrotask(() => callback({ exitCode: 0 }));
							return { dispose() {} };
						},
						kill() {},
					};
				},
			};
		},
	});
	expect(loaded).toEqual(["better-sqlite3", "@parcel/watcher", "node-pty"]);
	expect(closed).toBe(true);
	expect(pty).toBe(true);
});

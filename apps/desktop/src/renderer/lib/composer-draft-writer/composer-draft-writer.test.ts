import { expect, test } from "bun:test";
import { ComposerDraftWriter } from "./composer-draft-writer";

test("a late asynchronous draft save drains only the newest queued value and never drops it", async () => {
	const cache = new Map<string, string>();
	const writes: string[] = [];
	let finish!: (value: boolean) => void;
	const timers = new Set<() => void>();
	const writer = new ComposerDraftWriter(
		cache,
		(_key, value) => {
			writes.push(value);
			return writes.length === 1
				? new Promise<boolean>((resolve) => {
						finish = resolve;
					})
				: true;
		},
		(callback) => {
			timers.add(callback);
			return () => {
				timers.delete(callback);
			};
		},
	);
	writer.change("chat", "first");
	const pending = writer.flush();
	writer.change("chat", "newer");
	writer.change("chat", "latest");
	expect(writes).toEqual(["first"]);
	expect(timers.size).toBe(1);
	expect(cache.get("chat")).toBe("latest");
	finish(true);
	await pending;
	expect(writes).toEqual(["first", "latest"]);
	expect(cache.size).toBe(0);
	expect(timers.size).toBe(0);
});
test("a failed draft save retains the original value and retries only on an explicit flush or later edit", async () => {
	const cache = new Map<string, string>();
	let succeed = false;
	let calls = 0;
	const writer = new ComposerDraftWriter(
		cache,
		() => {
			calls++;
			return succeed;
		},
		() => () => {},
	);
	writer.change("chat", "retained");
	await writer.flush();
	expect(calls).toBe(1);
	expect(cache.get("chat")).toBe("retained");
	succeed = true;
	await writer.flush();
	expect(calls).toBe(2);
	expect(cache.size).toBe(0);
});

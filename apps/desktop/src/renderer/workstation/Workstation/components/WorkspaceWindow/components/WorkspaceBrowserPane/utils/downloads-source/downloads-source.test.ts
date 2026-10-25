import { expect, test } from "bun:test";
import type {
	WorkstationDownloadsApi,
	WorkstationDownloadsSnapshot,
} from "shared/workstation-browser";
import { downloadsSource } from "./downloads-source";
test("a late initial snapshot cannot rewind a newer download event, and closed subscriptions ignore later replies", async () => {
	const pending = Promise.withResolvers<WorkstationDownloadsSnapshot>();
	let listener: ((snapshot: WorkstationDownloadsSnapshot) => void) | undefined,
		stopped = 0;
	const api: WorkstationDownloadsApi = {
		getSnapshot: () => pending.promise,
		onChanged: (callback) => {
			listener = callback;
			return () => {
				stopped++;
			};
		},
		cancel: async () => ({ cancelled: false }),
		clear: async () => ({ success: true }),
		open: async () => ({ success: true }),
		showInFolder: async () => ({ success: true }),
	};
	const rows: unknown[] = [],
		errors: string[] = [];
	const stop = downloadsSource(api).subscribe(
		(data) => rows.push(data),
		() => errors.push("failed"),
	);
	const row = {
		id: "owned",
		filename: "file.txt",
		state: "progressing" as const,
		receivedBytes: 4,
		totalBytes: 8,
	};
	listener?.({ revision: 2, rows: [row] });
	pending.resolve({ revision: 1, rows: [] });
	await Promise.resolve();
	expect(rows).toEqual([[row]]);
	expect(errors).toEqual([]);
	stop();
	listener?.({ revision: 3, rows: [] });
	expect(stopped).toBe(1);
	expect(rows).toEqual([[row]]);
});
test("an initial read failure is visible unless a newer event has already supplied real data", async () => {
	const pending = Promise.withResolvers<WorkstationDownloadsSnapshot>();
	let listener: ((snapshot: WorkstationDownloadsSnapshot) => void) | undefined;
	let errors = 0;
	const api: WorkstationDownloadsApi = {
		getSnapshot: () => pending.promise,
		onChanged: (callback) => {
			listener = callback;
			return () => {};
		},
		cancel: async () => ({ cancelled: false }),
		clear: async () => ({ success: true }),
		open: async () => ({ success: true }),
		showInFolder: async () => ({ success: true }),
	};
	const stop = downloadsSource(api).subscribe(
		() => {},
		() => errors++,
	);
	listener?.({ revision: 1, rows: [] });
	pending.reject(Error("Owned stale read failed"));
	await Promise.resolve();
	expect(errors).toBe(0);
	stop();
	const failed = {
		...api,
		getSnapshot: async () => {
			throw Error("Owned current read failed");
		},
	};
	const stopFailed = downloadsSource(failed).subscribe(
		() => {},
		() => errors++,
	);
	await Promise.resolve();
	expect(errors).toBe(1);
	stopFailed();
});

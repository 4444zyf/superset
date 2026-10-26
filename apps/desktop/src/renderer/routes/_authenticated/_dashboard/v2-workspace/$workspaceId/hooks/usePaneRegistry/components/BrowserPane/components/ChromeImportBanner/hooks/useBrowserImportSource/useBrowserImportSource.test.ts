import { afterEach, expect, test } from "bun:test";
import { act, cleanup, renderHook } from "@testing-library/react";
import type { BrowserImportApi } from "shared/browser-import";
import { useBrowserImportSource } from "./useBrowserImportSource";

type Sources = Awaited<ReturnType<BrowserImportApi["getSources"]>>;
const profile = {
	id: "/owned/profile",
	browserKey: "chrome",
	browserName: "Google Chrome",
	profileName: "Owned",
};
function deferred() {
	let resolve!: (value: Sources) => void;
	const promise = new Promise<Sources>((r) => {
		resolve = r;
	});
	return { resolve, promise };
}
afterEach(cleanup);
test("banner discovery selects only the first detected browser without importing any data", async () => {
	let reads = 0;
	const source = {
		getSources: async () => {
			reads++;
			return {
				needsFullDiskAccess: false,
				sources: [
					profile,
					{ ...profile, browserKey: "brave", browserName: "Brave" },
				],
			};
		},
	};
	const { result } = renderHook(() => useBrowserImportSource(source));
	await act(async () => {});
	expect(result.current).toEqual({
		browserKey: "chrome",
		browserName: "Google Chrome",
	});
	expect(reads).toBe(1);
});
test("late replies from the previous source cannot replace the current detected browser", async () => {
	const old = deferred(),
		next = deferred();
	const source = { getSources: () => old.promise },
		replacement = { getSources: () => next.promise };
	const { result, rerender } = renderHook(
		({ api }) => useBrowserImportSource(api),
		{ initialProps: { api: source } },
	);
	rerender({ api: replacement });
	await act(async () =>
		old.resolve({ needsFullDiskAccess: false, sources: [profile] }),
	);
	expect(result.current).toBeNull();
	await act(async () =>
		next.resolve({
			needsFullDiskAccess: false,
			sources: [{ ...profile, browserKey: "brave", browserName: "Brave" }],
		}),
	);
	expect(result.current).toEqual({ browserKey: "brave", browserName: "Brave" });
});
test("disconnecting clears an already detected browser", async () => {
	const pending = deferred();
	const source = { getSources: () => pending.promise };
	const initialProps: { api: typeof source | undefined } = { api: source };
	const { result, rerender } = renderHook(
		({ api }: { api: typeof source | undefined }) =>
			useBrowserImportSource(api),
		{ initialProps },
	);
	await act(async () =>
		pending.resolve({ needsFullDiskAccess: false, sources: [profile] }),
	);
	expect(result.current?.browserKey).toBe("chrome");
	rerender({ api: undefined });
	expect(result.current).toBeNull();
});
test("unreadable browser sources do not offer a dead import action", async () => {
	const source = {
		getSources: async () => {
			throw Error("Unreadable");
		},
	};
	const { result } = renderHook(() => useBrowserImportSource(source));
	await act(async () => {});
	expect(result.current).toBeNull();
});

import { afterEach, expect, test } from "bun:test";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import {
	defaultBrowserPreferenceValues,
	type BrowserPreferenceApi,
	type BrowserPreferenceSnapshot,
} from "shared/workstation-browser-preferences";
import { useBrowserPreferences } from "./useBrowserPreferences";

afterEach(cleanup);
const snapshot = (
	revision = 0,
	invalid = false,
): BrowserPreferenceSnapshot => ({
	schemaVersion: 1,
	revision,
	invalid,
	values: defaultBrowserPreferenceValues(),
});

test("invalid preferences remain read only until an explicit CAS reset finishes and reloads", async () => {
	let backing = snapshot(3, true);
	const release = Promise.withResolvers<void>();
	const resets: unknown[] = [],
		updates: unknown[] = [];
	const api: BrowserPreferenceApi = {
		get: async () => backing,
		update: async (input) => {
			updates.push(input);
			return backing;
		},
		reset: async (input) => {
			resets.push(input);
			await release.promise;
			backing = snapshot(4);
			return backing;
		},
	};
	const hook = renderHook(() => useBrowserPreferences(api));
	await waitFor(() => expect(hook.result.current.snapshot?.invalid).toBe(true));
	await act(async () => {
		await expect(
			hook.result.current.update({ homepageUrl: "example.com" }),
		).rejects.toThrow("unavailable");
	});
	let reset!: Promise<void>;
	act(() => {
		reset = hook.result.current.reset();
	});
	expect(hook.result.current.saving).toBe(true);
	await act(async () => {
		await expect(
			hook.result.current.update({ homepageUrl: "other.example" }),
		).rejects.toThrow("progress");
		await expect(hook.result.current.reset()).rejects.toThrow("unavailable");
		release.resolve();
		await reset;
	});
	expect(resets).toEqual([{ expectedRevision: 3 }]);
	expect(updates).toEqual([]);
	expect(hook.result.current.snapshot).toEqual(snapshot(4));
	expect(hook.result.current.saving).toBe(false);
});

test("failed reset reports its error and an explicit reload clears it without repairing the saved data", async () => {
	const backing = snapshot(7, true);
	const api: BrowserPreferenceApi = {
		get: async () => backing,
		update: async () => backing,
		reset: async () => {
			throw Error("Owned reset write failed");
		},
	};
	const hook = renderHook(() => useBrowserPreferences(api));
	await waitFor(() => expect(hook.result.current.snapshot?.revision).toBe(7));
	await act(async () => {
		await expect(hook.result.current.reset()).rejects.toThrow(
			"Owned reset write failed",
		);
	});
	expect(hook.result.current.error).toBe("Owned reset write failed");
	expect(hook.result.current.saving).toBe(false);
	await act(async () => {
		await hook.result.current.reload();
	});
	expect(hook.result.current.error).toBeNull();
	expect(hook.result.current.snapshot).toEqual(backing);
});

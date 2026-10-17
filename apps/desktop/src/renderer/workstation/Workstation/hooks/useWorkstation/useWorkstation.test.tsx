import { afterEach, expect, test } from "bun:test";
import { act, cleanup, renderHook } from "@testing-library/react";
import type {
	DirectProfile,
	DirectWorkstationApi,
} from "../../../../../shared/direct-workstation";
import { useWorkstation } from "./useWorkstation";

afterEach(cleanup);
test("removing a connection waits for local draft persistence and retains the connection when that save fails", async () => {
	const profile: DirectProfile = {
		id: "machine",
		name: "Remote",
		host: "test.invalid",
	};
	let removed = 0;
	const api = {
		list: async () => [profile],
		remove: async () => {
			removed++;
		},
	} as unknown as DirectWorkstationApi;
	const hook = renderHook(() => useWorkstation(api));
	await act(async () => {
		for (let i = 0; i < 5; i++) await Promise.resolve();
	});
	await act(async () => {
		await hook.result.current.removeProfile(profile, async () => {
			throw new Error("Disk full");
		});
	});
	expect(removed).toBe(0);
	expect(hook.result.current.profiles).toEqual([profile]);
	expect(hook.result.current.error).toContain("Disk full");
});

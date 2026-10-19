import { afterEach, expect, test } from "bun:test";
import { act, cleanup, renderHook } from "@testing-library/react";
import type {
	DirectProfile,
	DirectWorkstationApi,
} from "../../../../../shared/direct-workstation";
import { useWorkstation } from "./useWorkstation";

afterEach(cleanup);
test("late local control completion cannot clear a newly selected namespace or publish its notice", async () => {
	let complete!: () => void;
	const pending = new Promise<void>((resolve) => {
		complete = resolve;
	});
	const api = {
		list: async () => [],
		control: async () => {
			await pending;
		},
	} as unknown as DirectWorkstationApi;
	const hook = renderHook(() => useWorkstation(api));
	await act(async () => {
		for (let n = 0; n < 5; n++) await Promise.resolve();
	});
	const profile: DirectProfile = {
		id: "local",
		kind: "local",
		name: "Local",
		host: "localhost",
	};
	const namespace = (namespaceId: string) => ({
		id: namespaceId,
		label: namespaceId,
		selected: true,
		isDefault: false,
		backendId: "backend",
		namespaceId,
	});
	act(() => hook.result.current.namespaceSelected(profile.id, namespace("A")));
	let operation!: Promise<unknown>;
	act(() => {
		operation = hook.result.current.control(profile, "start");
	});
	const next = {
		connectionId: profile.id,
		backendId: "backend",
		namespaceId: "B",
		instanceId: "instance",
		generation: 2,
	};
	act(() => {
		hook.result.current.namespaceSelected(profile.id, namespace("B"));
		hook.result.current.active.current = next;
	});
	await act(async () => {
		complete();
		await operation;
	});
	expect(hook.result.current.active.current).toBe(next);
	expect(hook.result.current.notice).toBeNull();
});
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

test("requested creation work remains pending through its follow-up actions until close can proceed", async () => {
	const api = { list: async () => [] } as unknown as DirectWorkstationApi;
	const hook = renderHook(() => useWorkstation(api));
	await act(async () => {
		for (let i = 0; i < 5; i++) await Promise.resolve();
	});
	let created!: () => void, followed!: () => void;
	const creation = new Promise<void>((resolve) => {
			created = resolve;
		}),
		followup = new Promise<void>((resolve) => {
			followed = resolve;
		});
	let operation!: Promise<unknown>,
		closed = false;
	act(() => {
		operation = hook.result.current.operation(
			async () => {
				await creation;
				await followup;
				return "done";
			},
			{ waitOnClose: true },
		);
	});
	const closing = hook.result.current.flushOperations().then(() => {
		closed = true;
	});
	await Promise.resolve();
	expect(closed).toBe(false);
	await act(async () => {
		created();
		for (let i = 0; i < 5; i++) await Promise.resolve();
	});
	expect(closed).toBe(false);
	await act(async () => {
		followed();
		await operation;
		await closing;
	});
	expect(closed).toBe(true);
});

test("ordinary connection work retains its existing close behavior", async () => {
	const api = { list: async () => [] } as unknown as DirectWorkstationApi;
	const hook = renderHook(() => useWorkstation(api));
	await act(async () => {
		for (let i = 0; i < 5; i++) await Promise.resolve();
	});
	let release!: () => void;
	const gate = new Promise<void>((resolve) => {
		release = resolve;
	});
	let pending!: Promise<unknown>;
	act(() => {
		pending = hook.result.current.operation(() => gate);
	});
	await hook.result.current.flushOperations();
	await act(async () => {
		release();
		await pending;
	});
});

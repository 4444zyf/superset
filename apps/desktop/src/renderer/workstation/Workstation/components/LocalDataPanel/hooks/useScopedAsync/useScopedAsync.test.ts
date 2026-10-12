import { afterEach, expect, test } from "bun:test";
import { act, cleanup, renderHook } from "@testing-library/react";
import { useScopedAsync } from "./useScopedAsync";

afterEach(cleanup);

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (error: unknown) => void;
	const promise = new Promise<T>((yes, no) => {
		resolve = yes;
		reject = no;
	});
	return { promise, resolve, reject };
}

test("returning to a scope cannot revive an old result or clear a newer operation", async () => {
	const values: string[] = [];
	const first = deferred<string>(),
		second = deferred<string>();
	const hook = renderHook(({ scope }) => useScopedAsync(scope, () => {}), {
		initialProps: { scope: "namespace-a" },
	});
	act(() => {
		void hook.result.current.run(
			() => first.promise,
			(value) => values.push(value),
		);
	});
	hook.rerender({ scope: "namespace-b" });
	hook.rerender({ scope: "namespace-a" });
	act(() => {
		void hook.result.current.run(
			() => second.promise,
			(value) => values.push(value),
		);
	});
	await act(async () => first.resolve("old"));
	expect(values).toEqual([]);
	expect(hook.result.current.busy).toBe(true);
	await act(async () => second.resolve("current"));
	expect(values).toEqual(["current"]);
	expect(hook.result.current.busy).toBe(false);
});

test("unmounting ignores a late failure without retrying its operation", async () => {
	const operation = deferred<void>();
	const errors: unknown[] = [];
	let calls = 0;
	const hook = renderHook(() =>
		useScopedAsync("namespace", (error) => errors.push(error)),
	);
	act(() => {
		void hook.result.current.run(() => {
			calls++;
			return operation.promise;
		});
	});
	hook.unmount();
	await act(async () => operation.reject(new Error("late failure")));
	expect(errors).toEqual([]);
	expect(calls).toBe(1);
});

import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { TRPCError } from "@trpc/server";
import { runBrowserReloadOperation } from "./browser-reload-operation";
import { DirectOperationStore } from "./operations";

function fixture() {
	const db = new Database(":memory:");
	const operations = new DirectOperationStore(db, "instance-a");
	const input = {
		operationId: crypto.randomUUID(),
		workspaceId: "owned",
		paneId: "page",
		hard: false,
	};
	return { db, operations, input };
}

test("reload is pinned before journal acceptance and dispatch happens only after acceptance", async () => {
	const f = fixture();
	try {
		let dispatched = 0;
		const receipt = await runBrowserReloadOperation(f.input, {
			operations: f.operations,
			pin: (input) => {
				expect(input).toEqual({
					workspaceId: "owned",
					paneId: "page",
					hard: false,
				});
				expect(f.operations.status(f.input.operationId)).toBe(null);
				return async () => {
					expect(f.operations.status(f.input.operationId)?.status).toBe(
						"accepted",
					);
					dispatched++;
					return { ok: true };
				};
			},
		});
		expect(receipt).toMatchObject({
			operationId: f.input.operationId,
			procedure: "browser.reloadV1",
			status: "completed",
			result: { ok: true },
		});
		expect(dispatched).toBe(1);
	} finally {
		f.db.close();
	}
});

test("concurrent repeats and completed reload receipts never pin or execute a second time", async () => {
	const f = fixture(),
		completion = Promise.withResolvers<{ ok: true }>();
	try {
		let pins = 0;
		const dependencies = {
			operations: f.operations,
			pin: () => {
				pins++;
				return () => completion.promise;
			},
		};
		const first = runBrowserReloadOperation(f.input, dependencies),
			second = runBrowserReloadOperation(f.input, dependencies);
		completion.resolve({ ok: true });
		const receipts = await Promise.all([first, second]);
		expect(receipts[0]).toEqual(receipts[1]);
		expect(await runBrowserReloadOperation(f.input, dependencies)).toEqual(
			receipts[0],
		);
		expect(pins).toBe(1);
	} finally {
		f.db.close();
	}
});

test("a journaled reload cannot change its pane or cache mode under the same operation ID", async () => {
	const f = fixture();
	try {
		let pins = 0;
		const dependencies = {
			operations: f.operations,
			pin: () => {
				pins++;
				return async () => ({ ok: true as const });
			},
		};
		await runBrowserReloadOperation(f.input, dependencies);
		await expect(
			runBrowserReloadOperation({ ...f.input, paneId: "other" }, dependencies),
		).rejects.toMatchObject({ code: "CONFLICT" });
		await expect(
			runBrowserReloadOperation({ ...f.input, hard: true }, dependencies),
		).rejects.toMatchObject({ code: "CONFLICT" });
		expect(pins).toBe(1);
	} finally {
		f.db.close();
	}
});

test("a window changing after the operation is pinned cannot retarget reload", async () => {
	const f = fixture();
	try {
		let windowEpoch = 1,
			reloads = 0;
		const operation = runBrowserReloadOperation(f.input, {
			operations: f.operations,
			pin: () => {
				const pinnedEpoch = windowEpoch;
				return async () => {
					if (windowEpoch !== pinnedEpoch)
						throw new TRPCError({
							code: "PRECONDITION_FAILED",
							message: "Owned peer changed",
						});
					reloads++;
					return { ok: true };
				};
			},
		}).catch((error) => error);
		windowEpoch++;
		expect(await operation).toMatchObject({ code: "PRECONDITION_FAILED" });
		expect(reloads).toBe(0);
		expect(f.operations.status(f.input.operationId)?.status).toBe("unresolved");
	} finally {
		f.db.close();
	}
});

test("a lost reload acknowledgement remains unresolved and is never automatically dispatched again", async () => {
	const f = fixture();
	try {
		let pins = 0,
			reloads = 0;
		const dependencies = {
			operations: f.operations,
			pin: () => {
				pins++;
				return async () => {
					reloads++;
					throw Error("Owned acknowledgement lost");
				};
			},
		};
		await expect(
			runBrowserReloadOperation(f.input, dependencies),
		).rejects.toThrow("Owned acknowledgement lost");
		await expect(
			runBrowserReloadOperation(f.input, dependencies),
		).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
		expect(f.operations.status(f.input.operationId)?.status).toBe("unresolved");
		expect([pins, reloads]).toEqual([1, 1]);
	} finally {
		f.db.close();
	}
});

test("an unavailable peer cannot create a journal entry before dispatch", async () => {
	const f = fixture();
	try {
		await expect(
			runBrowserReloadOperation(f.input, {
				operations: f.operations,
				pin: () => {
					throw Error("Owned peer unavailable");
				},
			}),
		).rejects.toThrow("Owned peer unavailable");
		expect(f.operations.status(f.input.operationId)).toBe(null);
		expect(f.operations.activeCreateOperations).toBe(0);
	} finally {
		f.db.close();
	}
});

test("draining blocks new reload but completed receipts remain readable without a desktop peer", async () => {
	const f = fixture();
	try {
		const receipt = await runBrowserReloadOperation(f.input, {
			operations: f.operations,
			pin: () => async () => ({ ok: true }),
		});
		f.operations.beginDrain(crypto.randomUUID(), true);
		const unavailable = {
			operations: f.operations,
			pin: () => {
				throw Error("Must not pin a draining backend");
			},
		};
		expect(await runBrowserReloadOperation(f.input, unavailable)).toEqual(
			receipt,
		);
		const next = { ...f.input, operationId: crypto.randomUUID() };
		expect(() => runBrowserReloadOperation(next, unavailable)).toThrow(
			"draining",
		);
		expect(f.operations.status(next.operationId)).toBe(null);
	} finally {
		f.db.close();
	}
});

test("omitted hard and explicit false share one durable reload intent", async () => {
	const f = fixture();
	try {
		let pins = 0,
			releases = 0;
		const dependencies = {
			operations: f.operations,
			pin: () => {
				pins++;
				const execute = async () => ({ ok: true as const });
				execute.release = () => {
					releases++;
				};
				return execute;
			},
		};
		const { hard: _, ...omitted } = f.input;
		const receipt = await runBrowserReloadOperation(omitted, dependencies);
		expect(await runBrowserReloadOperation(f.input, dependencies)).toEqual(
			receipt,
		);
		expect([pins, releases]).toEqual([1, 1]);
	} finally {
		f.db.close();
	}
});

test("invalid reload scope is rejected before pinning or journal acceptance", () => {
	const f = fixture();
	try {
		let pins = 0;
		const dependencies = {
			operations: f.operations,
			pin: () => {
				pins++;
				return async () => ({ ok: true as const });
			},
		};
		for (const bad of [
			{ ...f.input, operationId: "invalid" },
			{ ...f.input, paneId: "" },
			{ ...f.input, workspaceId: "" },
			{ ...f.input, hard: "true" },
			{ ...f.input, url: "https://other.invalid" },
		]) {
			expect(() => runBrowserReloadOperation(bad, dependencies)).toThrow();
		}
		expect(pins).toBe(0);
		expect(f.operations.status(f.input.operationId)).toBe(null);
	} finally {
		f.db.close();
	}
});

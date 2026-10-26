import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { TRPCError } from "@trpc/server";
import { runBrowserNavigationOperation } from "./browser-navigation-operation";
import { DirectOperationStore } from "./operations";

function fixture() {
	const db = new Database(":memory:");
	const operations = new DirectOperationStore(db, "instance-a");
	const input = {
		operationId: crypto.randomUUID(),
		workspaceId: "owned",
		paneId: "page",
		url: "http://localhost:3000/中文",
	};
	return { db, operations, input };
}

test("navigation is pinned before journal acceptance and dispatch happens only after acceptance", async () => {
	const f = fixture();
	try {
		let dispatched = 0;
		const receipt = await runBrowserNavigationOperation(f.input, {
			operations: f.operations,
			pin: (input) => {
				expect(input).toEqual({
					workspaceId: "owned",
					paneId: "page",
					url: f.input.url,
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
			procedure: "browser.navigateV1",
			status: "completed",
			result: { ok: true },
		});
		expect(dispatched).toBe(1);
	} finally {
		f.db.close();
	}
});

test("concurrent repeats and completed navigation receipts never pin or execute a second time", async () => {
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
		const first = runBrowserNavigationOperation(f.input, dependencies),
			second = runBrowserNavigationOperation(f.input, dependencies);
		completion.resolve({ ok: true });
		const receipts = await Promise.all([first, second]);
		expect(receipts[0]).toEqual(receipts[1]);
		expect(await runBrowserNavigationOperation(f.input, dependencies)).toEqual(
			receipts[0],
		);
		expect(pins).toBe(1);
	} finally {
		f.db.close();
	}
});

test("a journaled navigation cannot change its pane or URL under the same operation ID", async () => {
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
		await runBrowserNavigationOperation(f.input, dependencies);
		await expect(
			runBrowserNavigationOperation(
				{ ...f.input, paneId: "other" },
				dependencies,
			),
		).rejects.toMatchObject({ code: "CONFLICT" });
		await expect(
			runBrowserNavigationOperation(
				{ ...f.input, url: "https://other.invalid" },
				dependencies,
			),
		).rejects.toMatchObject({ code: "CONFLICT" });
		expect(pins).toBe(1);
	} finally {
		f.db.close();
	}
});

test("a window changing after the operation is pinned cannot retarget navigation", async () => {
	const f = fixture();
	try {
		let windowEpoch = 1,
			navigations = 0;
		const operation = runBrowserNavigationOperation(f.input, {
			operations: f.operations,
			pin: () => {
				const pinnedEpoch = windowEpoch;
				return async () => {
					if (windowEpoch !== pinnedEpoch)
						throw new TRPCError({
							code: "PRECONDITION_FAILED",
							message: "Owned peer changed",
						});
					navigations++;
					return { ok: true };
				};
			},
		}).catch((error) => error);
		windowEpoch++;
		expect(await operation).toMatchObject({ code: "PRECONDITION_FAILED" });
		expect(navigations).toBe(0);
		expect(f.operations.status(f.input.operationId)?.status).toBe("unresolved");
	} finally {
		f.db.close();
	}
});

test("a lost navigation acknowledgement remains unresolved and is never automatically dispatched again", async () => {
	const f = fixture();
	try {
		let pins = 0,
			navigations = 0;
		const dependencies = {
			operations: f.operations,
			pin: () => {
				pins++;
				return async () => {
					navigations++;
					throw Error("Owned acknowledgement lost");
				};
			},
		};
		await expect(
			runBrowserNavigationOperation(f.input, dependencies),
		).rejects.toThrow("Owned acknowledgement lost");
		await expect(
			runBrowserNavigationOperation(f.input, dependencies),
		).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
		expect(f.operations.status(f.input.operationId)?.status).toBe("unresolved");
		expect([pins, navigations]).toEqual([1, 1]);
	} finally {
		f.db.close();
	}
});

test("an unavailable peer cannot create a journal entry before dispatch", async () => {
	const f = fixture();
	try {
		await expect(
			runBrowserNavigationOperation(f.input, {
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

test("draining blocks new navigation but completed receipts remain readable without a desktop peer", async () => {
	const f = fixture();
	try {
		const receipt = await runBrowserNavigationOperation(f.input, {
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
		expect(await runBrowserNavigationOperation(f.input, unavailable)).toEqual(
			receipt,
		);
		const next = { ...f.input, operationId: crypto.randomUUID() };
		expect(() => runBrowserNavigationOperation(next, unavailable)).toThrow(
			"draining",
		);
		expect(f.operations.status(next.operationId)).toBe(null);
	} finally {
		f.db.close();
	}
});

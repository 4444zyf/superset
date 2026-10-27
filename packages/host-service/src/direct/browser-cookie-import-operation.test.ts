import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { TRPCError } from "@trpc/server";
import { runBrowserCookieImportOperation } from "./browser-cookie-import-operation";
import { DirectOperationStore } from "./operations";

const result = { imported: 2, skipped: 1, keyUnavailable: false };
function fixture(capacity?: number) {
	const db = new Database(":memory:");
	return {
		db,
		operations: new DirectOperationStore(db, "owned-instance", capacity),
		input: {
			operationId: crypto.randomUUID(),
			workspaceId: "owned",
			paneId: "page",
			sourceId: "/owned/配置/Default",
		},
	};
}
test("cookie import pins its target before journal acceptance and dispatches only after acceptance", async () => {
	const f = fixture();
	let dispatched = 0,
		released = 0;
	try {
		const receipt = await runBrowserCookieImportOperation(f.input, {
			operations: f.operations,
			pin: (input) => {
				expect(input).toEqual({
					workspaceId: "owned",
					paneId: "page",
					sourceId: f.input.sourceId,
				});
				expect(f.operations.status(f.input.operationId)).toBe(null);
				return Object.assign(
					async () => {
						expect(f.operations.status(f.input.operationId)?.status).toBe(
							"accepted",
						);
						dispatched++;
						return result;
					},
					{
						release: () => {
							released++;
						},
					},
				);
			},
		});
		expect(receipt).toMatchObject({
			operationId: f.input.operationId,
			procedure: "browser.importCookiesV1",
			status: "completed",
			result,
		});
		expect([dispatched, released]).toEqual([1, 1]);
	} finally {
		f.db.close();
	}
});
test("concurrent cookie imports with the same stable ID share their original result and never repin", async () => {
	const f = fixture(),
		done = Promise.withResolvers<typeof result>();
	let pins = 0;
	try {
		const deps = {
			operations: f.operations,
			pin: () => {
				pins++;
				return () => done.promise;
			},
		};
		const first = runBrowserCookieImportOperation(f.input, deps),
			second = runBrowserCookieImportOperation(f.input, deps);
		done.resolve(result);
		const receipts = await Promise.all([first, second]);
		expect(receipts[0]).toEqual(receipts[1]);
		expect(
			await runBrowserCookieImportOperation(f.input, {
				operations: f.operations,
				pin: () => {
					throw Error("Must not repin completed import");
				},
			}),
		).toEqual(receipts[0]);
		expect(pins).toBe(1);
	} finally {
		f.db.close();
	}
});
test("a stable cookie import ID cannot change its source profile, pane or workspace", async () => {
	const f = fixture();
	let pins = 0;
	try {
		const deps = {
			operations: f.operations,
			pin: () => {
				pins++;
				return async () => result;
			},
		};
		await runBrowserCookieImportOperation(f.input, deps);
		for (const changed of [
			{ sourceId: "/owned/Other" },
			{ paneId: "other" },
			{ workspaceId: "other" },
		])
			await expect(
				runBrowserCookieImportOperation({ ...f.input, ...changed }, deps),
			).rejects.toMatchObject({ code: "CONFLICT" });
		expect(pins).toBe(1);
	} finally {
		f.db.close();
	}
});
test("a target changing after pinning cannot be rebound before cookie import dispatch", async () => {
	const f = fixture();
	let epoch = 1,
		writes = 0;
	try {
		const pending = runBrowserCookieImportOperation(f.input, {
			operations: f.operations,
			pin: () => {
				const captured = epoch;
				return async () => {
					if (epoch !== captured)
						throw new TRPCError({
							code: "PRECONDITION_FAILED",
							message: "Owned import peer changed",
						});
					writes++;
					return result;
				};
			},
		}).catch((e) => e);
		epoch++;
		expect(await pending).toMatchObject({ code: "PRECONDITION_FAILED" });
		expect(writes).toBe(0);
		expect(f.operations.status(f.input.operationId)?.status).toBe("unresolved");
	} finally {
		f.db.close();
	}
});
test("a lost import acknowledgement remains unresolved and never repeats cookie side effects", async () => {
	const f = fixture();
	let pins = 0,
		writes = 0;
	try {
		const deps = {
			operations: f.operations,
			pin: () => {
				pins++;
				return async () => {
					writes++;
					throw Error("Owned import acknowledgement lost");
				};
			},
		};
		await expect(
			runBrowserCookieImportOperation(f.input, deps),
		).rejects.toThrow("acknowledgement lost");
		await expect(
			runBrowserCookieImportOperation(f.input, deps),
		).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
		expect(f.operations.status(f.input.operationId)?.status).toBe("unresolved");
		expect([pins, writes]).toEqual([1, 1]);
	} finally {
		f.db.close();
	}
});
test("journal capacity failure releases the cookie reservation without dispatch", async () => {
	const f = fixture(0);
	let pins = 0,
		writes = 0,
		releases = 0;
	try {
		await expect(
			runBrowserCookieImportOperation(f.input, {
				operations: f.operations,
				pin: () => {
					pins++;
					return Object.assign(
						async () => {
							writes++;
							return result;
						},
						{
							release: () => {
								releases++;
							},
						},
					);
				},
			}),
		).rejects.toThrow("journal is full");
		expect([pins, writes, releases]).toEqual([1, 0, 1]);
		expect(f.operations.status(f.input.operationId)).toBe(null);
		expect(f.operations.activeCreateOperations).toBe(0);
	} finally {
		f.db.close();
	}
});
test("unavailable cookie targets cannot create an accepted journal entry", async () => {
	const f = fixture();
	try {
		await expect(
			runBrowserCookieImportOperation(f.input, {
				operations: f.operations,
				pin: () => {
					throw Error("Owned import peer unavailable");
				},
			}),
		).rejects.toThrow("unavailable");
		expect(f.operations.status(f.input.operationId)).toBe(null);
		expect(f.operations.activeCreateOperations).toBe(0);
	} finally {
		f.db.close();
	}
});
test("draining stops new imports while completed receipts including key-unavailable results stay readable", async () => {
	const f = fixture();
	try {
		const unavailableKey = { imported: 0, skipped: 0, keyUnavailable: true },
			receipt = await runBrowserCookieImportOperation(f.input, {
				operations: f.operations,
				pin: () => async () => unavailableKey,
			});
		f.operations.beginDrain(crypto.randomUUID(), true);
		const deps = {
			operations: f.operations,
			pin: () => {
				throw Error("Must not pin a drained backend");
			},
		};
		expect(await runBrowserCookieImportOperation(f.input, deps)).toEqual(
			receipt,
		);
		expect(receipt.result).toEqual(unavailableKey);
		const next = { ...f.input, operationId: crypto.randomUUID() };
		expect(() => runBrowserCookieImportOperation(next, deps)).toThrow(
			"draining",
		);
		expect(f.operations.status(next.operationId)).toBe(null);
	} finally {
		f.db.close();
	}
});
test("invalid cookie import intent is rejected before pinning or journaling", () => {
	const f = fixture();
	let pins = 0;
	try {
		const deps = {
			operations: f.operations,
			pin: () => {
				pins++;
				return async () => result;
			},
		};
		for (const bad of [
			{ ...f.input, operationId: "invalid" },
			{ ...f.input, paneId: "" },
			{ ...f.input, workspaceId: "" },
			{ ...f.input, sourceId: "" },
			{ ...f.input, sourceId: "x".repeat(8193) },
			{ ...f.input, profileDir: "/foreign" },
			{ ...f.input, browserKey: "foreign" },
			{ ...f.input, partition: "other" },
		])
			expect(() => runBrowserCookieImportOperation(bad, deps)).toThrow();
		expect(pins).toBe(0);
		expect(f.operations.status(f.input.operationId)).toBe(null);
	} finally {
		f.db.close();
	}
});

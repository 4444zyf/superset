import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { TRPCError } from "@trpc/server";
import {
	type PinnedBrowserOpen,
	runBrowserOpenOperation,
} from "./browser-open-operation";
import { DirectOperationStore } from "./operations";

function fixture(capacity?: number) {
	const db = new Database(":memory:");
	const operations = new DirectOperationStore(db, "instance", capacity);
	const input = {
		operationId: crypto.randomUUID(),
		workspaceId: "owned",
		url: "localhost:3000/中文",
	};
	const result = {
		paneId: "created-pane",
		url: "http://localhost:3000/中文",
		title: "",
	};
	return { db, operations, input, result };
}

test("browser open pins background defaults before acceptance and dispatches only after the journal accepts", async () => {
	const f = fixture();
	let effects = 0;
	try {
		const receipt = await runBrowserOpenOperation(f.input, {
			operations: f.operations,
			pin: (input) => {
				expect(input).toEqual({
					workspaceId: "owned",
					url: f.input.url,
					target: "current-tab",
					show: false,
				});
				expect(f.operations.status(f.input.operationId)).toBe(null);
				return async () => {
					expect(f.operations.status(f.input.operationId)?.status).toBe(
						"accepted",
					);
					effects++;
					return f.result;
				};
			},
		});
		expect(receipt).toMatchObject({
			operationId: f.input.operationId,
			procedure: "browser.openV1",
			status: "completed",
			result: f.result,
		});
		expect(effects).toBe(1);
	} finally {
		f.db.close();
	}
});

test("concurrent and completed open requests create only one pane", async () => {
	const f = fixture(),
		completion = Promise.withResolvers<typeof f.result>();
	let pins = 0;
	try {
		const dependencies = {
			operations: f.operations,
			pin: () => {
				pins++;
				return () => completion.promise;
			},
		};
		const first = runBrowserOpenOperation(f.input, dependencies),
			second = runBrowserOpenOperation(f.input, dependencies);
		completion.resolve(f.result);
		const receipts = await Promise.all([first, second]);
		expect(receipts[0]).toEqual(receipts[1]);
		expect(await runBrowserOpenOperation(f.input, dependencies)).toEqual(
			receipts[0],
		);
		expect(pins).toBe(1);
	} finally {
		f.db.close();
	}
});

test("omitted and explicit background defaults share a receipt without a second pin", async () => {
	const f = fixture();
	let pins = 0;
	try {
		const dependencies = {
			operations: f.operations,
			pin: () => {
				pins++;
				return async () => f.result;
			},
		};
		const receipt = await runBrowserOpenOperation(f.input, dependencies);
		expect(
			await runBrowserOpenOperation(
				{ ...f.input, target: "current-tab", show: false },
				dependencies,
			),
		).toEqual(receipt);
		expect(pins).toBe(1);
	} finally {
		f.db.close();
	}
});

test("a journaled open cannot change its workspace, URL, placement or show intent", async () => {
	const f = fixture();
	let pins = 0;
	try {
		const dependencies = {
			operations: f.operations,
			pin: () => {
				pins++;
				return async () => f.result;
			},
		};
		await runBrowserOpenOperation(f.input, dependencies);
		for (const patch of [
			{ workspaceId: "other" },
			{ url: "https://other.invalid" },
			{ target: "new-tab" },
			{ show: true },
		])
			await expect(
				runBrowserOpenOperation({ ...f.input, ...patch }, dependencies),
			).rejects.toMatchObject({ code: "CONFLICT" });
		expect(pins).toBe(1);
	} finally {
		f.db.close();
	}
});

test("an explicitly requested new tab and show intent reach the captured executor", async () => {
	const f = fixture();
	try {
		await runBrowserOpenOperation(
			{ ...f.input, target: "new-tab", show: true },
			{
				operations: f.operations,
				pin: (input) => {
					expect(input).toMatchObject({ target: "new-tab", show: true });
					return async () => f.result;
				},
			},
		);
	} finally {
		f.db.close();
	}
});

test("a renderer replacement after pinning cannot retarget an accepted open", async () => {
	const f = fixture();
	let epoch = 1,
		effects = 0;
	try {
		const pending = runBrowserOpenOperation(f.input, {
			operations: f.operations,
			pin: () => {
				const pinned = epoch;
				return async () => {
					if (epoch !== pinned)
						throw new TRPCError({
							code: "PRECONDITION_FAILED",
							message: "Owned renderer changed",
						});
					effects++;
					return f.result;
				};
			},
		}).catch((error) => error);
		epoch++;
		expect(await pending).toMatchObject({ code: "PRECONDITION_FAILED" });
		expect(effects).toBe(0);
		expect(f.operations.status(f.input.operationId)?.status).toBe("unresolved");
	} finally {
		f.db.close();
	}
});

test("an open with a lost acknowledgement never creates a replacement pane", async () => {
	const f = fixture();
	let pins = 0,
		effects = 0;
	try {
		const dependencies = {
			operations: f.operations,
			pin: () => {
				pins++;
				return async () => {
					effects++;
					throw Error("Owned acknowledgement lost");
				};
			},
		};
		await expect(
			runBrowserOpenOperation(f.input, dependencies),
		).rejects.toThrow("Owned acknowledgement lost");
		await expect(
			runBrowserOpenOperation(f.input, dependencies),
		).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
		expect([pins, effects]).toEqual([1, 1]);
		expect(f.operations.status(f.input.operationId)?.status).toBe("unresolved");
	} finally {
		f.db.close();
	}
});

test("an unavailable open target cannot leave an accepted journal entry", async () => {
	const f = fixture();
	try {
		await expect(
			runBrowserOpenOperation(f.input, {
				operations: f.operations,
				pin: () => {
					throw Error("Owned target unavailable");
				},
			}),
		).rejects.toThrow("Owned target unavailable");
		expect(f.operations.status(f.input.operationId)).toBe(null);
		expect(f.operations.activeCreateOperations).toBe(0);
	} finally {
		f.db.close();
	}
});

test("a full journal releases an open reservation without dispatch", async () => {
	const f = fixture(0);
	let effects = 0,
		releases = 0;
	try {
		await expect(
			runBrowserOpenOperation(f.input, {
				operations: f.operations,
				pin: () => {
					const execute: PinnedBrowserOpen = async () => {
						effects++;
						return f.result;
					};
					execute.release = () => {
						releases++;
					};
					return execute;
				},
			}),
		).rejects.toThrow("journal is full");
		expect([effects, releases]).toEqual([0, 1]);
		expect(f.operations.status(f.input.operationId)).toBe(null);
	} finally {
		f.db.close();
	}
});

test("maintenance rejects a new open while the completed receipt remains readable without its renderer", async () => {
	const f = fixture();
	try {
		const receipt = await runBrowserOpenOperation(f.input, {
			operations: f.operations,
			pin: () => async () => f.result,
		});
		f.operations.beginDrain(crypto.randomUUID(), true);
		const dependencies = {
			operations: f.operations,
			pin: () => {
				throw Error("Must not rebind the completed open");
			},
		};
		expect(await runBrowserOpenOperation(f.input, dependencies)).toEqual(
			receipt,
		);
		expect(() =>
			runBrowserOpenOperation(
				{ ...f.input, operationId: crypto.randomUUID() },
				dependencies,
			),
		).toThrow("draining");
	} finally {
		f.db.close();
	}
});

test("malformed open scope and unknown placement are refused before pinning", () => {
	const f = fixture();
	let pins = 0;
	try {
		const dependencies = {
			operations: f.operations,
			pin: () => {
				pins++;
				return async () => f.result;
			},
		};
		for (const patch of [
			{ operationId: "invalid" },
			{ workspaceId: "" },
			{ url: "" },
			{ url: "x".repeat(8193) },
			{ url: "http://localhost/\n" },
			{ target: "typo" },
			{ show: "false" },
			{ paneId: "existing-pane" },
		])
			expect(() =>
				runBrowserOpenOperation({ ...f.input, ...patch }, dependencies),
			).toThrow();
		expect(pins).toBe(0);
		expect(f.operations.status(f.input.operationId)).toBe(null);
	} finally {
		f.db.close();
	}
});

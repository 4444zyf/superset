import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { TRPCError } from "@trpc/server";
import { runBrowserEvaluationOperation } from "./browser-evaluation-operation";
import { DirectOperationStore } from "./operations";

function fixture() {
	const db = new Database(":memory:");
	const operations = new DirectOperationStore(db, "instance-a");
	const input = {
		operationId: crypto.randomUUID(),
		workspaceId: "owned",
		paneId: "page",
		code: "document.title",
	};
	return { db, operations, input };
}

test("evaluation is pinned before journal acceptance and dispatch happens only after acceptance", async () => {
	const f = fixture();
	try {
		let dispatched = 0;
		const receipt = await runBrowserEvaluationOperation(f.input, {
			operations: f.operations,
			pin: (input) => {
				expect(input).toEqual({
					workspaceId: "owned",
					paneId: "page",
					code: f.input.code,
				});
				expect(f.operations.status(f.input.operationId)).toBe(null);
				return async () => {
					expect(f.operations.status(f.input.operationId)?.status).toBe(
						"accepted",
					);
					dispatched++;
					return { result: "中文 🙂" };
				};
			},
		});
		expect(receipt).toMatchObject({
			operationId: f.input.operationId,
			procedure: "browser.evaluateV1",
			status: "completed",
			result: { result: "中文 🙂" },
		});
		expect(dispatched).toBe(1);
	} finally {
		f.db.close();
	}
});

test("concurrent repeats and completed evaluation receipts never pin or execute a second time", async () => {
	const f = fixture(),
		completion = Promise.withResolvers<{ result: string }>();
	try {
		let pins = 0;
		const dependencies = {
			operations: f.operations,
			pin: () => {
				pins++;
				return () => completion.promise;
			},
		};
		const first = runBrowserEvaluationOperation(f.input, dependencies),
			second = runBrowserEvaluationOperation(f.input, dependencies);
		completion.resolve({ result: "中文 🙂" });
		const receipts = await Promise.all([first, second]);
		expect(receipts[0]).toEqual(receipts[1]);
		expect(await runBrowserEvaluationOperation(f.input, dependencies)).toEqual(
			receipts[0],
		);
		expect(pins).toBe(1);
	} finally {
		f.db.close();
	}
});

test("a journaled evaluation cannot change its pane or code under the same operation ID", async () => {
	const f = fixture();
	try {
		let pins = 0;
		const dependencies = {
			operations: f.operations,
			pin: () => {
				pins++;
				return async () => ({ result: "中文 🙂" });
			},
		};
		await runBrowserEvaluationOperation(f.input, dependencies);
		await expect(
			runBrowserEvaluationOperation(
				{ ...f.input, paneId: "other" },
				dependencies,
			),
		).rejects.toMatchObject({ code: "CONFLICT" });
		await expect(
			runBrowserEvaluationOperation(
				{ ...f.input, code: "document.title = 'changed'" },
				dependencies,
			),
		).rejects.toMatchObject({ code: "CONFLICT" });
		expect(pins).toBe(1);
	} finally {
		f.db.close();
	}
});

test("a window changing after the operation is pinned cannot retarget evaluation", async () => {
	const f = fixture();
	try {
		let windowEpoch = 1,
			evaluations = 0;
		const operation = runBrowserEvaluationOperation(f.input, {
			operations: f.operations,
			pin: () => {
				const pinnedEpoch = windowEpoch;
				return async () => {
					if (windowEpoch !== pinnedEpoch)
						throw new TRPCError({
							code: "PRECONDITION_FAILED",
							message: "Owned peer changed",
						});
					evaluations++;
					return { result: "中文 🙂" };
				};
			},
		}).catch((error) => error);
		windowEpoch++;
		expect(await operation).toMatchObject({ code: "PRECONDITION_FAILED" });
		expect(evaluations).toBe(0);
		expect(f.operations.status(f.input.operationId)?.status).toBe("unresolved");
	} finally {
		f.db.close();
	}
});

test("a lost evaluation acknowledgement remains unresolved and is never automatically dispatched again", async () => {
	const f = fixture();
	try {
		let pins = 0,
			evaluations = 0;
		const dependencies = {
			operations: f.operations,
			pin: () => {
				pins++;
				return async () => {
					evaluations++;
					throw Error("Owned acknowledgement lost");
				};
			},
		};
		await expect(
			runBrowserEvaluationOperation(f.input, dependencies),
		).rejects.toThrow("Owned acknowledgement lost");
		await expect(
			runBrowserEvaluationOperation(f.input, dependencies),
		).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
		expect(f.operations.status(f.input.operationId)?.status).toBe("unresolved");
		expect([pins, evaluations]).toEqual([1, 1]);
	} finally {
		f.db.close();
	}
});

test("an unavailable peer cannot create a journal entry before dispatch", async () => {
	const f = fixture();
	try {
		await expect(
			runBrowserEvaluationOperation(f.input, {
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

test("draining blocks new evaluation but completed receipts remain readable without a desktop peer", async () => {
	const f = fixture();
	try {
		const receipt = await runBrowserEvaluationOperation(f.input, {
			operations: f.operations,
			pin: () => async () => ({ result: "中文 🙂" }),
		});
		f.operations.beginDrain(crypto.randomUUID(), true);
		const unavailable = {
			operations: f.operations,
			pin: () => {
				throw Error("Must not pin a draining backend");
			},
		};
		expect(await runBrowserEvaluationOperation(f.input, unavailable)).toEqual(
			receipt,
		);
		const next = { ...f.input, operationId: crypto.randomUUID() };
		expect(() => runBrowserEvaluationOperation(next, unavailable)).toThrow(
			"draining",
		);
		expect(f.operations.status(next.operationId)).toBe(null);
	} finally {
		f.db.close();
	}
});

test("evaluation releases its reservation if journal acceptance fails", async () => {
	const db = new Database(":memory:");
	const operations = new DirectOperationStore(db, "instance-full", 0);
	const input = {
		operationId: crypto.randomUUID(),
		workspaceId: "owned",
		paneId: "page",
		code: "document.title",
	};
	let executions = 0,
		releases = 0;
	try {
		await expect(
			runBrowserEvaluationOperation(input, {
				operations,
				pin: () => {
					const execute = Object.assign(
						async () => {
							executions++;
							return { result: "never" };
						},
						{
							release: () => {
								releases++;
							},
						},
					);
					return execute;
				},
			}),
		).rejects.toThrow("journal is full");
		expect([executions, releases]).toEqual([0, 1]);
		expect(operations.status(input.operationId)).toBe(null);
		expect(operations.activeCreateOperations).toBe(0);
	} finally {
		db.close();
	}
});

test("evaluation rejects malformed scope, oversized code and unknown input before pinning", () => {
	const f = fixture();
	let pins = 0;
	const dependencies = {
		operations: f.operations,
		pin: () => {
			pins++;
			return async () => ({ result: null });
		},
	};
	try {
		for (const input of [
			{ ...f.input, operationId: "invalid" },
			{ ...f.input, workspaceId: "" },
			{ ...f.input, paneId: "" },
			{ ...f.input, code: "a".repeat(1000001) },
			{ ...f.input, url: "https://other.invalid" },
		])
			expect(() =>
				runBrowserEvaluationOperation(input, dependencies),
			).toThrow();
		expect(pins).toBe(0);
		expect(f.operations.status(f.input.operationId)).toBe(null);
	} finally {
		f.db.close();
	}
});

test("durable evaluation results preserve falsy values and structured data", async () => {
	const f = fixture();
	try {
		for (const result of [
			false,
			0,
			null,
			"",
			undefined,
			{ message: "中文 🙂", values: [1, false, null] },
		]) {
			const input = { ...f.input, operationId: crypto.randomUUID() };
			let pins = 0;
			const dependencies = {
				operations: f.operations,
				pin: () => {
					pins++;
					return async () => ({ result });
				},
			};
			const receipt = await runBrowserEvaluationOperation(input, dependencies);
			expect(receipt.result).toEqual({ result });
			expect(await runBrowserEvaluationOperation(input, dependencies)).toEqual(
				receipt,
			);
			expect(pins).toBe(1);
		}
	} finally {
		f.db.close();
	}
});

test("empty expressions and the original one-million-character limit remain accepted", async () => {
	const f = fixture();
	try {
		for (const code of ["", "a".repeat(1_000_000)]) {
			const input = { ...f.input, operationId: crypto.randomUUID(), code };
			let seen: string | undefined;
			const receipt = await runBrowserEvaluationOperation(input, {
				operations: f.operations,
				pin: (value) => {
					seen = value.code;
					return async () => ({ result: null });
				},
			});
			expect(seen).toBe(code);
			expect(receipt.status).toBe("completed");
		}
	} finally {
		f.db.close();
	}
});

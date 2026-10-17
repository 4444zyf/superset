import { expect, test } from "bun:test";
import { TRPCError } from "@trpc/server";
import { trackedDestroy } from "./tracked-destroy";

test("a teardown failure remains a typed result without running cleanup twice", async () => {
	let calls = 0;
	const cause = {
		kind: "TEARDOWN_FAILED",
		exitCode: 17,
		signal: null,
		timedOut: false,
		outputTail: "cleanup failed",
	};
	const result = await trackedDestroy(async () => {
		calls++;
		throw new TRPCError({
			code: "PRECONDITION_FAILED",
			message: "Teardown script failed",
			cause,
		});
	});
	expect(result).toEqual({ outcome: "teardown-failed", cause });
	expect(calls).toBe(1);
});

test("a dirty or concurrent deletion conflict does not force retry", async () => {
	const result = await trackedDestroy(async () => {
		throw new TRPCError({
			code: "CONFLICT",
			message: "Deletion already in progress",
			cause: { kind: "DELETE_IN_PROGRESS" },
		});
	});
	expect(result).toEqual({
		outcome: "blocked",
		message: "Deletion already in progress",
	});
});

test("uncertain cleanup failures propagate for reconciliation", async () => {
	await expect(
		trackedDestroy(async () => {
			throw new Error("disk unavailable");
		}),
	).rejects.toThrow("disk unavailable");
});

test("a successful deletion retains cleanup warnings", async () => {
	expect(
		await trackedDestroy(async () => ({
			warnings: ["terminal may still run"],
		})),
	).toEqual({ outcome: "deleted", warnings: ["terminal may still run"] });
});

test("a persisted teardown failure can be read after restart without rerunning the script", async () => {
	const { Database } = await import("bun:sqlite");
	const { DirectOperationStore } = await import("../../../direct/operations");
	const db = new Database(":memory:");
	try {
		let calls = 0;
		const execute = () =>
			trackedDestroy(async () => {
				calls++;
				throw new TRPCError({
					code: "PRECONDITION_FAILED",
					message: "Teardown script failed",
					cause: {
						kind: "TEARDOWN_FAILED",
						exitCode: 17,
						signal: null,
						timedOut: false,
						outputTail: "failed",
					},
				});
			});
		await new DirectOperationStore(db, "one").execute(
			"delete",
			"workspaceCleanup.destroyTrackedV1",
			{ workspaceId: "workspace" },
			execute,
		);
		const restarted = new DirectOperationStore(db, "two");
		expect(
			await restarted.execute(
				"delete",
				"workspaceCleanup.destroyTrackedV1",
				{ workspaceId: "workspace" },
				execute,
			),
		).toMatchObject({
			status: "completed",
			result: {
				outcome: "teardown-failed",
				cause: { exitCode: 17, outputTail: "failed" },
			},
		});
		expect(calls).toBe(1);
	} finally {
		db.close();
	}
});

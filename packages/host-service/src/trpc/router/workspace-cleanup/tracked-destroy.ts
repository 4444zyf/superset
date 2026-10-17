import { TRPCError } from "@trpc/server";
import {
	isTeardownFailureCause,
	type TeardownFailureCause,
} from "../../error-types";

export type TrackedDestroyResult =
	| { outcome: "deleted"; warnings: string[] }
	| { outcome: "teardown-failed"; cause: TeardownFailureCause }
	| { outcome: "blocked"; message: string };

export async function trackedDestroy(
	destroy: () => Promise<{ warnings: string[] }>,
): Promise<TrackedDestroyResult> {
	try {
		const result = await destroy();
		return { outcome: "deleted", warnings: result.warnings };
	} catch (error) {
		if (error instanceof TRPCError) {
			if (
				error.code === "PRECONDITION_FAILED" &&
				isTeardownFailureCause(error.cause)
			)
				return {
					outcome: "teardown-failed",
					cause: {
						kind: "TEARDOWN_FAILED",
						exitCode: error.cause.exitCode,
						signal: error.cause.signal,
						timedOut: error.cause.timedOut,
						outputTail: error.cause.outputTail.slice(-64 * 1024),
					},
				};
			if (error.code === "CONFLICT")
				return { outcome: "blocked", message: error.message };
		}
		throw error;
	}
}

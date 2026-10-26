import { TRPCError } from "@trpc/server";
import type { HostServiceContext } from "../types";
import {
	type PinnedBrowserEvaluation,
	runBrowserEvaluationOperation,
} from "./browser-evaluation-operation";
import { DirectBrowserBridgeError } from "./browser-read-bridge";

function rpcError(error: unknown): unknown {
	if (!(error instanceof DirectBrowserBridgeError)) return error;
	const codes: Record<DirectBrowserBridgeError["kind"], TRPCError["code"]> = {
		unavailable: "PRECONDITION_FAILED",
		busy: "TOO_MANY_REQUESTS",
		timeout: "NOT_FOUND",
		invalid: "BAD_REQUEST",
		failed: "BAD_REQUEST",
	};
	return new TRPCError({
		code: codes[error.kind],
		message: error.message,
		cause: error,
	});
}

export function runDirectBrowserEvaluation(
	ctx: HostServiceContext,
	input: unknown,
) {
	if (!ctx.direct || !ctx.directOperations)
		throw new TRPCError({
			code: "PRECONDITION_FAILED",
			message: "Durable direct operations are unavailable on this host",
		});
	return runBrowserEvaluationOperation(input, {
		operations: ctx.directOperations,
		pin: (value) => {
			const bridge = ctx.directBrowserReads;
			if (!bridge?.isEvaluationReady?.() || !bridge.pinEvaluation)
				throw new TRPCError({
					code: "PRECONDITION_FAILED",
					message:
						"This host has no browser panes (no desktop app is attached to it).",
				});
			let pinned: PinnedBrowserEvaluation;
			try {
				pinned = bridge.pinEvaluation(value);
			} catch (error) {
				throw rpcError(error);
			}
			const execute: PinnedBrowserEvaluation = async () => {
				try {
					return await pinned();
				} catch (error) {
					throw rpcError(error);
				}
			};
			execute.release = () => pinned.release?.();
			return execute;
		},
	});
}

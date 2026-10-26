import { TRPCError } from "@trpc/server";
import type { HostServiceContext } from "../types";
import { DirectBrowserBridgeError } from "./browser-read-bridge";
import {
	runBrowserNavigationOperation,
	type PinnedBrowserNavigation,
} from "./browser-navigation-operation";

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

export function runDirectBrowserNavigation(
	ctx: HostServiceContext,
	input: unknown,
) {
	if (!ctx.direct || !ctx.directOperations)
		throw new TRPCError({
			code: "PRECONDITION_FAILED",
			message: "Durable direct operations are unavailable on this host",
		});
	return runBrowserNavigationOperation(input, {
		operations: ctx.directOperations,
		pin: (value) => {
			const bridge = ctx.directBrowserReads;
			if (!bridge?.isNavigationReady?.() || !bridge.pinNavigation)
				throw new TRPCError({
					code: "PRECONDITION_FAILED",
					message:
						"This host has no browser panes (no desktop app is attached to it).",
				});
			let pinned: PinnedBrowserNavigation;
			try {
				pinned = bridge.pinNavigation(value);
			} catch (error) {
				throw rpcError(error);
			}
			const execute: PinnedBrowserNavigation = async () => {
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

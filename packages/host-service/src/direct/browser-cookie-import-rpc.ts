import { TRPCError } from "@trpc/server";
import type { HostServiceContext } from "../types";
import {
	type PinnedBrowserCookieImport,
	runBrowserCookieImportOperation,
} from "./browser-cookie-import-operation";
import { DirectBrowserBridgeError } from "./browser-read-bridge";

function rpcError(error: unknown): unknown {
	if (!(error instanceof DirectBrowserBridgeError)) return error;
	const codes: Record<DirectBrowserBridgeError["kind"], TRPCError["code"]> = {
		unavailable: "PRECONDITION_FAILED",
		busy: "TOO_MANY_REQUESTS",
		timeout: "PRECONDITION_FAILED",
		invalid: "BAD_REQUEST",
		failed: "BAD_REQUEST",
	};
	return new TRPCError({
		code: codes[error.kind],
		message: error.message,
		cause: error,
	});
}

export function runDirectBrowserCookieImport(
	ctx: HostServiceContext,
	input: unknown,
) {
	if (!ctx.direct || !ctx.directOperations)
		throw new TRPCError({
			code: "PRECONDITION_FAILED",
			message: "Durable direct operations are unavailable on this host",
		});
	return runBrowserCookieImportOperation(input, {
		operations: ctx.directOperations,
		pin: (value) => {
			const bridge = ctx.directBrowserReads;
			if (!bridge?.isCookieImportReady?.() || !bridge.pinCookieImport)
				throw new TRPCError({
					code: "PRECONDITION_FAILED",
					message:
						"This host has no browser panes (no desktop app is attached to it).",
				});
			let pinned: PinnedBrowserCookieImport;
			try {
				pinned = bridge.pinCookieImport(value);
			} catch (error) {
				throw rpcError(error);
			}
			const execute: PinnedBrowserCookieImport = async () => {
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

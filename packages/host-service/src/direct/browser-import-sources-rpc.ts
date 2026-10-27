import { TRPCError } from "@trpc/server";
import type { HostServiceContext } from "../types";
import { DirectBrowserBridgeError } from "./browser-read-bridge";
export async function readDirectBrowserImportSources(ctx: HostServiceContext) {
	if (
		!ctx.direct ||
		!ctx.directBrowserReads?.isImportSourcesReady?.() ||
		!ctx.directBrowserReads.importSources
	)
		throw new TRPCError({
			code: "PRECONDITION_FAILED",
			message: "Browser login sources are unavailable on this host",
		});
	try {
		return await ctx.directBrowserReads.importSources();
	} catch (error) {
		if (!(error instanceof DirectBrowserBridgeError)) throw error;
		const codes: Record<DirectBrowserBridgeError["kind"], TRPCError["code"]> = {
			unavailable: "PRECONDITION_FAILED",
			busy: "TOO_MANY_REQUESTS",
			timeout: "NOT_FOUND",
			invalid: "BAD_REQUEST",
			failed: "BAD_REQUEST",
		};
		throw new TRPCError({
			code: codes[error.kind],
			message: error.message,
			cause: error,
		});
	}
}

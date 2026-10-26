import { getLocalWorkspace } from "../workspaces/local-workspace-store";
import { TRPCError } from "@trpc/server";
import type { HostServiceContext } from "../types";
import { DirectBrowserBridgeError } from "./browser-read-bridge";
import {
	runBrowserOpenOperation,
	type PinnedBrowserOpen,
} from "./browser-open-operation";

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

export function runDirectBrowserOpen(ctx: HostServiceContext, input: unknown) {
	if (!ctx.direct || !ctx.directOperations)
		throw new TRPCError({
			code: "PRECONDITION_FAILED",
			message: "Durable direct operations are unavailable on this host",
		});
	return runBrowserOpenOperation(input, {
		operations: ctx.directOperations,
		pin: (value) => {
			const bridge = ctx.directBrowserReads;
			if (!bridge?.isOpenReady?.() || !bridge.pinOpen)
				throw new TRPCError({
					code: "PRECONDITION_FAILED",
					message: "Browser open renderer is not ready to accept requests.",
				});
			let pinned: PinnedBrowserOpen;
			try {
				const workspace = getLocalWorkspace(ctx.db, value.workspaceId);
				if (!workspace)
					throw new TRPCError({
						code: "NOT_FOUND",
						message: "Workspace not found",
					});
				pinned = bridge.pinOpen({
					...value,
					projectId: workspace.projectId,
					workspaceName: (workspace.name || workspace.id).slice(0, 4096),
				});
			} catch (error) {
				throw rpcError(error);
			}
			const execute: PinnedBrowserOpen = async () => {
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

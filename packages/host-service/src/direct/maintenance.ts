import { TRPCError } from "@trpc/server";
import type { HostServiceRuntime } from "../types";
import type { DirectOperationStore } from "./operations";

export function directMaintenanceStatus(
	store: DirectOperationStore | undefined,
	runtime: HostServiceRuntime,
) {
	if (!store)
		throw new TRPCError({
			code: "PRECONDITION_FAILED",
			message: "Direct backend maintenance is unavailable",
		});
	const chat = runtime.chatMaintenanceStatus?.() ?? {
		activeChat: 0,
		queuedPrompts: 0,
		waitingApprovals: 0,
	};
	const activeCreateOperations = store.activeCreateOperations;
	const activeBackgroundOperations = runtime.pullRequests.activeOperations ?? 0;
	return {
		...store.maintenance(),
		...chat,
		activeCreateOperations,
		activeBackgroundOperations,
		safeToRestart:
			chat.activeChat === 0 &&
			chat.queuedPrompts === 0 &&
			chat.waitingApprovals === 0 &&
			activeCreateOperations === 0 &&
			activeBackgroundOperations === 0,
	};
}

export function beginDirectDrain(
	ownerId: string,
	freeze: boolean,
	store: DirectOperationStore | undefined,
	runtime: HostServiceRuntime,
) {
	if (!store)
		throw new TRPCError({
			code: "PRECONDITION_FAILED",
			message: "Direct backend maintenance is unavailable",
		});
	if (freeze && !directMaintenanceStatus(store, runtime).safeToRestart)
		throw new TRPCError({
			code: "CONFLICT",
			message: "Active work must finish before the backend can freeze",
		});
	store.beginDrain(ownerId, freeze);
	runtime.suspendBackground?.();
	return directMaintenanceStatus(store, runtime);
}

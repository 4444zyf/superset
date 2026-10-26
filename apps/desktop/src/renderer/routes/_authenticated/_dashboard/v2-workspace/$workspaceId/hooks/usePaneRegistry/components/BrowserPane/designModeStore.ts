import { toast } from "@superset/ui/sonner";
import { electronTrpcClient } from "renderer/lib/trpc-client";
import {
	type DesignModeState,
	DesignModeStoreCore,
	useDesignModeStateCore,
} from "./designModeStoreCore";

export type { DesignModePhase, DesignModeState } from "./designModeStoreCore";

export const designModeStore = new DesignModeStoreCore(
	electronTrpcClient.browser,
	toast.error,
);

export function useDesignModeState(paneId: string): DesignModeState {
	return useDesignModeStateCore(paneId, designModeStore);
}

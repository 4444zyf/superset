import { useCallback, useSyncExternalStore } from "react";
import type {
	BrowserRuntimeRegistryCore,
	BrowserRuntimeState,
} from "../../browserRuntimeRegistryCore";

export function useBrowserStateCore(
	paneId: string,
	registry: Pick<BrowserRuntimeRegistryCore, "onStateChange" | "getState">,
): BrowserRuntimeState {
	return useSyncExternalStore(
		useCallback((cb) => registry.onStateChange(paneId, cb), [paneId, registry]),
		useCallback(() => registry.getState(paneId), [paneId, registry]),
	);
}

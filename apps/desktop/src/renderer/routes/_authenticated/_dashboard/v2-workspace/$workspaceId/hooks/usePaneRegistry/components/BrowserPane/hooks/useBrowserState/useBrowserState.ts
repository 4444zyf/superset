import {
	type BrowserRuntimeState,
	browserRuntimeRegistry,
} from "../../browserRuntimeRegistry";
import { useBrowserStateCore } from "./useBrowserStateCore";

export function useBrowserState(paneId: string): BrowserRuntimeState {
	return useBrowserStateCore(paneId, browserRuntimeRegistry);
}

import { electronTrpcClient } from "renderer/lib/trpc-client";
import {
	type BrowserRuntimeIpc,
	BrowserRuntimeRegistryCore,
} from "./browserRuntimeRegistryCore";

export {
	BROWSER_ZOOM,
	type BrowserRuntimeIpc,
	type BrowserRuntimeState,
	type BrowserZoomDirection,
	type PersistableBrowserState,
} from "./browserRuntimeRegistryCore";

export class BrowserRuntimeRegistryImpl extends BrowserRuntimeRegistryCore {
	constructor(ipc: BrowserRuntimeIpc = electronTrpcClient) {
		super(ipc);
	}
}

export const browserRuntimeRegistry: BrowserRuntimeRegistryImpl =
	(import.meta.hot?.data?.browserRegistry as
		| BrowserRuntimeRegistryImpl
		| undefined) ?? new BrowserRuntimeRegistryImpl();

if (import.meta.hot) {
	import.meta.hot.data.browserRegistry = browserRuntimeRegistry;
}

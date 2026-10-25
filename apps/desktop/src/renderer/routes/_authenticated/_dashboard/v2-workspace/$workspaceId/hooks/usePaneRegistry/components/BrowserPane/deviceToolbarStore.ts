import { electronTrpcClient } from "renderer/lib/trpc-client";
import {
	DeviceToolbarStoreCore,
	useDeviceToolbarStateCore,
	type DeviceToolbarState,
} from "./deviceToolbarStoreCore";
export type { DeviceToolbarState } from "./deviceToolbarStoreCore";
export const deviceToolbarStore = new DeviceToolbarStoreCore((input) =>
	electronTrpcClient.browser.setDeviceEmulation.mutate(input),
);
export function useDeviceToolbarState(paneId: string): DeviceToolbarState {
	return useDeviceToolbarStateCore(paneId, deviceToolbarStore);
}

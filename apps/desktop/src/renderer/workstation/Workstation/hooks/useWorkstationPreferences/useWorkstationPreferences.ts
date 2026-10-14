import { useEffect, useMemo, useSyncExternalStore } from "react";
import type { DirectWorkstationApi } from "../../../../../shared/direct-workstation";
import { PreferenceClient } from "./preference-client";

export function useWorkstationPreferences(api: DirectWorkstationApi) {
	const client = useMemo(() => new PreferenceClient(api), [api]);
	const state = useSyncExternalStore(
		client.subscribe,
		client.getSnapshot,
		client.getSnapshot,
	);
	useEffect(() => {
		if (api.getPreferences) void client.load().catch(() => {});
	}, [client, api]);
	return {
		...state,
		update: client.update.bind(client),
		reload: client.load.bind(client),
	};
}

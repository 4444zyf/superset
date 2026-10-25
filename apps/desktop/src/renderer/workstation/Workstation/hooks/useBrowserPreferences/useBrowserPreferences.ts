import {
	useEffect,
	useMemo,
	useRef,
	useState,
	useSyncExternalStore,
} from "react";
import type {
	BrowserPreferenceApi,
	BrowserPreferencePatch,
	BrowserPreferenceSnapshot,
} from "shared/workstation-browser-preferences";
import { RevisionedPreferenceClient } from "../useWorkstationPreferences/preference-client";

export function useBrowserPreferences(api: BrowserPreferenceApi | undefined) {
	const client = useMemo(
		() =>
			new RevisionedPreferenceClient<
				BrowserPreferenceSnapshot,
				BrowserPreferencePatch
			>({
				getPreferences: api ? () => api.get() : undefined,
				updatePreferences: api ? (input) => api.update(input) : undefined,
			}),
		[api],
	);
	const state = useSyncExternalStore(
		client.subscribe,
		client.getSnapshot,
		client.getSnapshot,
	);
	const resettingRef = useRef(false);
	const [resetting, setResetting] = useState(false);
	const [resetError, setResetError] = useState<string | null>(null);
	useEffect(() => {
		if (api) void client.load().catch(() => {});
	}, [api, client]);
	return {
		...state,
		available: !!api,
		saving: state.saving || resetting,
		error: resetError ?? state.error,
		reload: () => {
			setResetError(null);
			return client.load();
		},
		update: (patch: BrowserPreferencePatch) => {
			if (resettingRef.current)
				return Promise.reject(
					new Error("A settings update is already in progress"),
				);
			setResetError(null);
			return client.update(patch);
		},
		reset: async () => {
			const current = client.getSnapshot();
			if (
				!api ||
				!current.snapshot ||
				current.loading ||
				current.saving ||
				resettingRef.current
			)
				throw Error("Browser preferences are unavailable");
			resettingRef.current = true;
			setResetting(true);
			setResetError(null);
			try {
				await api.reset({ expectedRevision: current.snapshot.revision });
				await client.load();
			} catch (error) {
				setResetError(error instanceof Error ? error.message : String(error));
				throw error;
			} finally {
				resettingRef.current = false;
				setResetting(false);
			}
		},
	};
}
export type BrowserPreferencesState = ReturnType<typeof useBrowserPreferences>;

import { electronTrpcClient } from "renderer/lib/trpc-client";
import {
	type HistorySuggestion,
	useUrlAutocompleteCore,
} from "./useUrlAutocompleteCore";

export type { HistorySuggestion } from "./useUrlAutocompleteCore";

export function loadDefaultBrowserHistory(): Promise<HistorySuggestion[]> {
	return electronTrpcClient.browserHistory.getAll.query();
}

export function useUrlAutocomplete(options: {
	onSelect: (url: string) => void;
}) {
	return useUrlAutocompleteCore({
		...options,
		loadHistory: loadDefaultBrowserHistory,
	});
}

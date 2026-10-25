import { browserRuntimeRegistry } from "../../browserRuntimeRegistry";
import {
	type BrowserToolbarProps,
	BrowserToolbarView,
} from "./components/BrowserToolbarView";
import { loadDefaultBrowserHistory } from "./hooks/useUrlAutocomplete/useUrlAutocomplete";

export function BrowserToolbar(props: BrowserToolbarProps) {
	return (
		<BrowserToolbarView
			{...props}
			registry={browserRuntimeRegistry}
			loadHistory={loadDefaultBrowserHistory}
		/>
	);
}

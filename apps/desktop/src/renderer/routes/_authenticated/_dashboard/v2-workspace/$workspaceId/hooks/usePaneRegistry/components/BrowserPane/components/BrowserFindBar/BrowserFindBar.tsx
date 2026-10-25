import { browserRuntimeRegistry } from "../../browserRuntimeRegistry";
import {
	type BrowserFindBarProps,
	BrowserFindBarView,
} from "./components/BrowserFindBarView";

export function BrowserFindBar(props: BrowserFindBarProps) {
	return <BrowserFindBarView {...props} registry={browserRuntimeRegistry} />;
}

import { electronTrpcClient } from "renderer/lib/trpc-client";
import {
	ClearBrowsingDataDialogView,
	type ClearBrowsingDataSource,
} from "./components/ClearBrowsingDataDialogView";
const source: ClearBrowsingDataSource = {
	clearHistory: () => electronTrpcClient.browserHistory.clear.mutate(),
	clearCookies: () =>
		electronTrpcClient.browser.clearBrowsingData.mutate({ type: "cookies" }),
	clearCache: () =>
		electronTrpcClient.browser.clearBrowsingData.mutate({ type: "cache" }),
};
export function ClearBrowsingDataDialog(props: {
	open: boolean;
	onOpenChange(open: boolean): void;
}) {
	return <ClearBrowsingDataDialogView {...props} source={source} />;
}

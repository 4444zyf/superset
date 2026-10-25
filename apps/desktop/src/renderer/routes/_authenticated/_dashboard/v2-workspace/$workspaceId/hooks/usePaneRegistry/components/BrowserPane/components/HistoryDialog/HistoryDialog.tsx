import { electronTrpcClient } from "renderer/lib/trpc-client";
import {
	HistoryDialogView,
	type BrowserHistorySource,
} from "./components/HistoryDialogView";
const source: BrowserHistorySource = {
	getAll: () => electronTrpcClient.browserHistory.getAll.query(),
	search: (input) => electronTrpcClient.browserHistory.search.query(input),
	clear: () => electronTrpcClient.browserHistory.clear.mutate(),
};
export function HistoryDialog(props: {
	open: boolean;
	onOpenChange(open: boolean): void;
	onSelect(url: string): void;
}) {
	return <HistoryDialogView {...props} source={source} />;
}

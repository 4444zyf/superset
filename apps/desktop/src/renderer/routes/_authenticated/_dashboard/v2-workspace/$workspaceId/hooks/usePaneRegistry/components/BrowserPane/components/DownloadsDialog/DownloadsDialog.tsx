import { electronTrpcClient } from "renderer/lib/trpc-client";
import {
	DownloadsDialogView,
	type DownloadsSource,
} from "./components/DownloadsDialogView";
const source: DownloadsSource = {
	subscribe: (onData, onError) => {
		const sub = electronTrpcClient.downloads.onChanged.subscribe(undefined, {
			onData,
			onError,
		});
		return () => sub.unsubscribe();
	},
	cancel: (id) => electronTrpcClient.downloads.cancel.mutate({ id }),
	open: (id) => electronTrpcClient.downloads.openFile.mutate({ id }),
	showInFolder: (id) =>
		electronTrpcClient.downloads.showInFolder.mutate({ id }),
	clear: () => electronTrpcClient.downloads.clear.mutate(),
};
export function DownloadsDialog(props: {
	open: boolean;
	onOpenChange(open: boolean): void;
}) {
	return <DownloadsDialogView {...props} source={source} />;
}

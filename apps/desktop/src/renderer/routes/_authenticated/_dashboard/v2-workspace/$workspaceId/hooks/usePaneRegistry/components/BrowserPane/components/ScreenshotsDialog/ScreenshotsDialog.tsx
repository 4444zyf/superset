import { useMemo } from "react";
import { useCopyToClipboard } from "renderer/hooks/useCopyToClipboard";
import { electronTrpcClient } from "renderer/lib/trpc-client";
import {
	ScreenshotsDialogView,
	type ScreenshotsSource,
} from "./components/ScreenshotsDialogView";
export function ScreenshotsDialog(props: {
	open: boolean;
	onOpenChange(open: boolean): void;
}) {
	const { copyToClipboard } = useCopyToClipboard();
	const source = useMemo<ScreenshotsSource>(
		() => ({
			subscribe: (onData, onError) => {
				const sub = electronTrpcClient.screenshots.onChanged.subscribe(
					undefined,
					{ onData, onError },
				);
				return () => sub.unsubscribe();
			},
			open: (id) => electronTrpcClient.screenshots.openFile.mutate({ id }),
			showInFolder: (id) =>
				electronTrpcClient.screenshots.showInFolder.mutate({ id }),
			clear: () => electronTrpcClient.screenshots.clear.mutate(),
			copyPath: copyToClipboard,
		}),
		[copyToClipboard],
	);
	return <ScreenshotsDialogView {...props} source={source} />;
}

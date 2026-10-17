import { useUrlLinkAction } from "renderer/lib/clickPolicy/policies/useUrlLinkAction";
import { electronTrpcClient } from "renderer/lib/trpc-client";
import { useMarkdownStyle } from "renderer/stores/markdown-preferences/store";
import { useTheme } from "renderer/stores/theme";
import {
	TipTapMarkdownSurface,
	type TipTapMarkdownSurfaceProps,
} from "../TipTapMarkdownSurface";
export { applyExternalMarkdown } from "../TipTapMarkdownSurface/TipTapMarkdownSurface";
export type { MarkdownEditorAdapter } from "../TipTapMarkdownSurface";
export type TipTapMarkdownRendererProps = Omit<
	TipTapMarkdownSurfaceProps,
	"isDark" | "getLinkAction" | "onOpenUrl"
> & { onOpenUrl?: TipTapMarkdownSurfaceProps["onOpenUrl"] };
export function TipTapMarkdownRenderer(props: TipTapMarkdownRendererProps) {
	const style = useMarkdownStyle();
	const theme = useTheme();
	const paneAction = useUrlLinkAction("4-tier");
	const inlineAction = useUrlLinkAction("2-tier");
	return (
		<TipTapMarkdownSurface
			{...props}
			style={props.style ?? style}
			isDark={theme?.type !== "light"}
			getLinkAction={props.onOpenUrl ? paneAction : inlineAction}
			onOpenUrl={
				props.onOpenUrl ??
				((url) => {
					void electronTrpcClient.external.openUrl
						.mutate(url)
						.catch((error) =>
							console.error(
								"[TipTapMarkdownRenderer] Failed to open URL:",
								url,
								error,
							),
						);
				})
			}
		/>
	);
}

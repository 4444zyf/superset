import { tierFor } from "renderer/lib/clickPolicy/tiers";
import type { TerminalLinkHandlers } from "renderer/lib/terminal/terminal-link-manager";
import { DEFAULT_V2_USER_PREFERENCES } from "renderer/routes/_authenticated/providers/CollectionsProvider/dashboardSidebarLocal/schema";

export function terminalUrlLinks({
	isCurrent,
	isReviewing,
	onOpenUrl,
}: {
	isCurrent(): boolean;
	isReviewing(): boolean;
	onOpenUrl(url: string): void;
}): Pick<TerminalLinkHandlers, "onUrlClick"> {
	return {
		onUrlClick: (event, url) => {
			if (
				!isCurrent() ||
				isReviewing() ||
				event.button !== 0 ||
				DEFAULT_V2_USER_PREFERENCES.urlLinks[tierFor(event, "4-tier")] !==
					"external"
			)
				return;
			event.preventDefault();
			onOpenUrl(url);
		},
	};
}

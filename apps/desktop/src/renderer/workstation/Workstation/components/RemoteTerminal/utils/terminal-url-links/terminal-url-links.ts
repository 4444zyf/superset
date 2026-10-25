import { tierFor } from "renderer/lib/clickPolicy/tiers";
import type { TerminalLinkHandlers } from "renderer/lib/terminal/terminal-link-manager";
import { DEFAULT_V2_USER_PREFERENCES } from "renderer/routes/_authenticated/providers/CollectionsProvider/dashboardSidebarLocal/schema";
import type { ModifierEvent } from "renderer/lib/clickPolicy/types";
import type { BrowserLinkAction } from "shared/workstation-browser-preferences";

export function terminalUrlLinks({
	isCurrent,
	isReviewing,
	onOpenUrl,
	getAction,
}: {
	isCurrent(): boolean;
	isReviewing(): boolean;
	onOpenUrl(url: string, action: BrowserLinkAction): void;
	getAction?(event: ModifierEvent): BrowserLinkAction | null;
}): Pick<TerminalLinkHandlers, "onUrlClick"> {
	return {
		onUrlClick: (event, url) => {
			if (!isCurrent() || isReviewing() || event.button !== 0) return;
			const action = getAction
				? getAction(event)
				: DEFAULT_V2_USER_PREFERENCES.urlLinks[tierFor(event, "4-tier")] ===
						"external"
					? "external"
					: null;
			if (!action) return;
			event.preventDefault();
			onOpenUrl(url, action);
		},
	};
}

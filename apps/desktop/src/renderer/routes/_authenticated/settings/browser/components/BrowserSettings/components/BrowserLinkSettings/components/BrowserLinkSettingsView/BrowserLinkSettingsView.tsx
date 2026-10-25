import { Trans, useLingui } from "@lingui/react/macro";
import { Label } from "@superset/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@superset/ui/select";
import { actionLabel } from "renderer/lib/clickPolicy/actionLabel";
import type { LinkAction, LinkTierMap } from "renderer/lib/clickPolicy/types";
import { HighlightText } from "renderer/routes/_authenticated/settings/components/HighlightText";
import { LinkTierMapperView } from "renderer/routes/_authenticated/settings/components/LinkTierMapper/components/LinkTierMapperView";
const PORT_ACTIONS: LinkAction[] = ["pane", "newTab", "external"];
interface BrowserLinkSettingsViewProps {
	urlDescription?: string;
	urlLinks: LinkTierMap;
	portOpenAction: LinkAction;
	onUrlLinks(next: LinkTierMap): void;
	onPortOpenAction(next: LinkAction): void;
	showUrl?: boolean;
	showPort?: boolean;
	showPortDescription?: boolean;
	searchQuery?: string;
	disabled?: boolean;
	isRightPaneAreaEnabled?: boolean;
}
export function BrowserLinkSettingsView({
	urlLinks,
	urlDescription,
	portOpenAction,
	onUrlLinks: handleUrlChange,
	onPortOpenAction: handlePortChange,
	showUrl = true,
	showPort = true,
	showPortDescription = true,
	searchQuery = "",
	disabled = false,
	isRightPaneAreaEnabled = false,
}: BrowserLinkSettingsViewProps) {
	const { t } = useLingui();
	return (
		<>
			{showUrl && (
				<LinkTierMapperView
					title={t({
						message: "URL links",
					})}
					description={
						urlDescription ??
						t({
							message:
								"Applies to URLs in terminals, chat messages, and task browsers.",
						})
					}
					value={urlLinks}
					onChange={handleUrlChange}
					idPrefix="links-url"
					surface="url"
					searchQuery={searchQuery}
					disabled={disabled}
					isRightPaneAreaEnabled={isRightPaneAreaEnabled}
				/>
			)}
			{showPort && (
				<div className="rounded-lg border border-border overflow-hidden">
					<div className="flex flex-wrap items-center justify-between gap-4 px-4 py-3">
						<div className="min-w-0 flex-1 basis-64 space-y-1">
							<Label
								htmlFor="links-port-action"
								className="text-sm font-medium"
							>
								<HighlightText
									text={t({ message: "Ports" })}
									query={searchQuery}
								/>
							</Label>
							{showPortDescription && (
								<p className="text-xs text-muted-foreground">
									<Trans>
										Where detected-port badges in the sidebar open when clicked.
									</Trans>
								</p>
							)}
						</div>
						<Select
							disabled={disabled}
							value={portOpenAction}
							onValueChange={(v) => handlePortChange(v as LinkAction)}
						>
							<SelectTrigger
								id="links-port-action"
								size="sm"
								className="w-60 max-w-full shrink-0"
							>
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								{PORT_ACTIONS.map((action) => (
									<SelectItem key={action} value={action}>
										{actionLabel(action, "url")}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</div>
				</div>
			)}
		</>
	);
}

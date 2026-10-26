import { Trans, useLingui } from "@lingui/react/macro";
import { Tooltip, TooltipContent, TooltipTrigger } from "@superset/ui/tooltip";
import { cn } from "@superset/ui/utils";
import { SquareDashedMousePointer } from "lucide-react";
export function DesignModeButton({
	active,
	disabled,
	onToggle,
	unavailableReason,
}: {
	active: boolean;
	disabled: boolean;
	onToggle(): void;
	unavailableReason?: string;
}) {
	const { t } = useLingui();
	return (
		<Tooltip disableHoverableContent>
			<TooltipTrigger asChild>
				<button
					type="button"
					aria-label={t({ message: "Design" })}
					title={unavailableReason}
					onClick={onToggle}
					disabled={disabled}
					aria-pressed={active}
					className={cn(
						"flex h-[22px] shrink-0 items-center gap-1 rounded-md px-1.5 text-[11px] font-medium leading-none transition-colors disabled:opacity-40",
						// Armed color matches the in-page picker outline
						// (design-mode-script.ts), not the theme primary.
						active
							? "bg-[#0d99ff] text-white hover:bg-[#0d99ff]/90"
							: "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
					)}
				>
					<SquareDashedMousePointer className="size-3" />
					{/* Icon-only in a narrow pane; the label comes back with room. */}
					<span className="hidden @min-[360px]/pane-header:inline">
						<Trans>Design</Trans>
					</span>
				</button>
			</TooltipTrigger>
			<TooltipContent side="bottom">
				{unavailableReason ? (
					unavailableReason
				) : active ? (
					<Trans>Exit design mode (esc)</Trans>
				) : (
					<Trans>
						Design mode — click any element in the page to send it to an agent
					</Trans>
				)}
			</TooltipContent>
		</Tooltip>
	);
}

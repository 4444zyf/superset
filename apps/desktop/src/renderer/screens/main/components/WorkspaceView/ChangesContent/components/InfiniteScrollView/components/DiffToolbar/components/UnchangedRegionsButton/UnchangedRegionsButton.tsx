import { Trans, useLingui } from "@lingui/react/macro";
import { Tooltip, TooltipContent, TooltipTrigger } from "@superset/ui/tooltip";
import { cn } from "@superset/ui/utils";
import { TbFold } from "react-icons/tb";
export function UnchangedRegionsButton({
	hideUnchangedRegions,
	onToggle,
}: {
	hideUnchangedRegions: boolean;
	onToggle(): void;
}) {
	const { t } = useLingui();
	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<button
					type="button"
					onClick={onToggle}
					className={cn(
						"rounded p-1 transition-colors hover:bg-accent",
						hideUnchangedRegions
							? "text-foreground"
							: "text-muted-foreground/60 hover:text-muted-foreground",
					)}
					aria-label={
						hideUnchangedRegions
							? t({ message: "Show all lines" })
							: t({ message: "Hide unchanged regions" })
					}
					aria-pressed={hideUnchangedRegions}
				>
					<TbFold className="size-4" />
				</button>
			</TooltipTrigger>
			<TooltipContent side="bottom">
				{hideUnchangedRegions ? (
					<Trans>Show all lines</Trans>
				) : (
					<Trans>Hide unchanged regions</Trans>
				)}
			</TooltipContent>
		</Tooltip>
	);
}

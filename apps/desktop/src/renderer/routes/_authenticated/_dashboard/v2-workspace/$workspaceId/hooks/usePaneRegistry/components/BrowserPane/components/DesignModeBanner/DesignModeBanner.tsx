import { Trans, useLingui } from "@lingui/react/macro";
import { SquareDashedMousePointer, XIcon } from "lucide-react";
export function DesignModeBanner({
	phase,
	onExit,
}: {
	phase: "selecting" | "confirming";
	onExit(): void;
}) {
	const { t } = useLingui();
	return (
		<div className="flex shrink-0 items-center gap-2 border-b border-border/60 bg-[#0d99ff]/10 px-3 py-1.5 text-xs text-foreground/90">
			<SquareDashedMousePointer className="size-3.5 shrink-0 text-[#0d99ff]" />
			<span className="min-w-0 flex-1 truncate">
				{phase === "selecting" ? (
					<Trans>
						Design mode — click any element in the page to send it to an agent.
					</Trans>
				) : (
					<Trans>
						Element captured — describe the change, or press esc to pick again.
					</Trans>
				)}
			</span>
			{phase === "selecting" && (
				<span className="shrink-0 text-muted-foreground/70">
					<Trans>esc to exit</Trans>
				</span>
			)}
			<button
				type="button"
				onClick={onExit}
				aria-label={t({
					message: "Exit design mode",
				})}
				className="shrink-0 rounded p-0.5 text-muted-foreground/60 transition-colors hover:text-muted-foreground"
			>
				<XIcon className="size-3.5" />
			</button>
		</div>
	);
}

import { Trans, useLingui } from "@lingui/react/macro";
import { Tooltip, TooltipContent, TooltipTrigger } from "@superset/ui/tooltip";
import { SquareDashedMousePointer, XIcon } from "lucide-react";
import { useEffect, useRef, type CSSProperties, type ReactNode } from "react";
import { LuArrowUp, LuLoaderCircle } from "react-icons/lu";
import type { DesignModePayload } from "shared/browser-design-mode";
import { shortDesignModeElementLabel } from "../../../../designModePrompt";

interface DesignModePopoverViewProps {
	payload: DesignModePayload;
	style: CSSProperties;
	comment: string;
	onCommentChange(comment: string): void;
	submitting: boolean;
	canSubmit: boolean;
	onSubmit(): void;
	onDismiss(): void;
	agentPicker: ReactNode;
	notice?: ReactNode;
}
const TEXTAREA_MAX_HEIGHT = 120;

export function DesignModePopoverView({
	payload,
	style,
	comment,
	onCommentChange,
	submitting,
	canSubmit,
	onSubmit,
	onDismiss,
	agentPicker,
	notice,
}: DesignModePopoverViewProps) {
	const { t } = useLingui();
	const textareaRef = useRef<HTMLTextAreaElement>(null);

	useEffect(() => {
		textareaRef.current?.focus();
	}, []);

	const autoGrow = () => {
		const el = textareaRef.current;
		if (!el) return;
		el.style.height = "auto";
		el.style.height = `${Math.min(el.scrollHeight, TEXTAREA_MAX_HEIGHT)}px`;
	};

	return (
		<div className="pointer-events-auto absolute z-20" style={style}>
			<form
				className="overflow-hidden rounded-xl border border-border/80 bg-popover text-popover-foreground shadow-[0_4px_16px_-4px_rgba(0,0,0,0.25),0_2px_4px_-2px_rgba(0,0,0,0.12)]"
				onSubmit={(e) => {
					e.preventDefault();
					onSubmit();
				}}
				onKeyDown={(e) => {
					if (e.key === "Escape") {
						e.stopPropagation();
						onDismiss();
					}
					// isComposing: Enter that commits an IME candidate must not send.
					if (
						e.key === "Enter" &&
						!e.shiftKey &&
						!e.nativeEvent.isComposing &&
						canSubmit
					) {
						e.preventDefault();
						onSubmit();
					}
				}}
			>
				<div className="flex flex-wrap items-start gap-x-1.5 gap-y-1 px-3 pt-2.5 pb-1">
					<span className="inline-flex max-w-56 shrink-0 items-center gap-1 pt-px text-[13px] font-medium text-[#0d99ff]">
						<SquareDashedMousePointer className="size-3.5 shrink-0" />
						<span className="truncate">
							{shortDesignModeElementLabel(payload)}
						</span>
					</span>
					<textarea
						ref={textareaRef}
						value={comment}
						onChange={(e) => {
							onCommentChange(e.target.value);
							autoGrow();
						}}
						placeholder={t({
							message: "Describe the change…",
						})}
						rows={1}
						className="block min-w-[140px] flex-1 resize-none bg-transparent text-[13px] leading-snug text-foreground placeholder:text-muted-foreground/60 focus:outline-none"
					/>
				</div>

				{notice}
				<div className="flex items-center gap-1.5 px-2.5 pb-2 pt-1">
					<Tooltip disableHoverableContent>
						<TooltipTrigger asChild>
							<button
								type="button"
								onClick={onDismiss}
								aria-label={t({
									message: "Pick a different element",
								})}
								className="inline-flex h-6 shrink-0 items-center gap-0.5 rounded-full border border-border/60 px-1.5 text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
							>
								<SquareDashedMousePointer className="size-3" />
								<XIcon className="size-3" />
							</button>
						</TooltipTrigger>
						<TooltipContent side="bottom">
							<Trans>Pick a different element (esc)</Trans>
						</TooltipContent>
					</Tooltip>
					{agentPicker}
					<button
						type="submit"
						disabled={!canSubmit}
						aria-label={t({
							message: "Send to agent",
						})}
						className="ml-auto grid size-6 shrink-0 place-items-center rounded-full bg-foreground text-background transition-opacity hover:opacity-90 disabled:opacity-35"
					>
						{submitting ? (
							<LuLoaderCircle className="size-3.5 animate-spin" />
						) : (
							<LuArrowUp className="size-3.5" strokeWidth={2.5} />
						)}
					</button>
				</div>
			</form>
		</div>
	);
}

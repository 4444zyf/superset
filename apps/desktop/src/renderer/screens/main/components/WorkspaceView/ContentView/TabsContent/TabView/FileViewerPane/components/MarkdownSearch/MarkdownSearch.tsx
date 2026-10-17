import { msg } from "@lingui/core/macro";
import { useLingui as useTranslation } from "@lingui/react";
import { Trans } from "@lingui/react/macro";
import { formatNumber } from "@superset/i18n/format";
import { Tooltip, TooltipContent, TooltipTrigger } from "@superset/ui/tooltip";
import { useEffect, useRef } from "react";
import { HiChevronDown, HiChevronUp, HiMiniXMark } from "react-icons/hi2";
import { PiTextAa } from "react-icons/pi";

interface MarkdownSearchProps {
	isOpen: boolean;
	query: string;
	caseSensitive: boolean;
	matchCount: number;
	activeMatchIndex: number;
	onQueryChange: (query: string) => void;
	onCaseSensitiveChange: (caseSensitive: boolean) => void;
	onFindNext: () => void;
	onFindPrevious: () => void;
	onClose: () => void;
}

export function MarkdownSearch({
	isOpen,
	query,
	caseSensitive,
	matchCount: rawMatchCount,
	activeMatchIndex,
	onQueryChange,
	onCaseSensitiveChange,
	onFindNext,
	onFindPrevious,
	onClose,
}: MarkdownSearchProps) {
	const { _: translate } = useTranslation();
	const matchCount = formatNumber(rawMatchCount);

	const inputRef = useRef<HTMLInputElement>(null);

	useEffect(() => {
		if (isOpen && inputRef.current) {
			inputRef.current.focus();
			inputRef.current.select();
		}
	}, [isOpen]);

	const handleKeyDown = (e: React.KeyboardEvent) => {
		if (e.key === "Escape") {
			e.preventDefault();
			onClose();
		} else if (e.key === "Enter") {
			e.preventDefault();
			if (e.shiftKey) {
				onFindPrevious();
			} else {
				onFindNext();
			}
		}
	};

	if (!isOpen) return null;

	return (
		<div className="absolute top-1 right-1 z-10 flex items-center max-w-[calc(100%-0.5rem)] rounded bg-popover/95 pl-2 pr-0.5 shadow-lg ring-1 ring-border/40 backdrop-blur">
			<input
				ref={inputRef}
				type="text"
				value={query}
				onChange={(e) => onQueryChange(e.target.value)}
				onKeyDown={handleKeyDown}
				placeholder={translate(msg({ message: "Find" }))}
				aria-label={translate(msg({ message: "Find" }))}
				className="h-6 min-w-0 w-28 flex-shrink bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
			/>
			{query && (
				<span className="text-xs text-muted-foreground whitespace-nowrap px-1">
					{rawMatchCount === 0 ? (
						<Trans>No results</Trans>
					) : (
						<Trans>
							{formatNumber(activeMatchIndex + 1)} of {matchCount}
						</Trans>
					)}
				</span>
			)}
			<div className="flex items-center shrink-0">
				<Tooltip>
					<TooltipTrigger asChild>
						<button
							type="button"
							onClick={() => onCaseSensitiveChange(!caseSensitive)}
							aria-label={translate(msg({ message: "Match case" }))}
							aria-pressed={caseSensitive}
							className={`rounded p-1 transition-colors ${
								caseSensitive
									? "bg-primary/20 text-foreground"
									: "text-muted-foreground hover:bg-muted-foreground/20 hover:text-foreground"
							}`}
						>
							<PiTextAa className="size-3.5" />
						</button>
					</TooltipTrigger>
					<TooltipContent side="bottom">
						<Trans>Match case</Trans>
					</TooltipContent>
				</Tooltip>
				<Tooltip>
					<TooltipTrigger asChild>
						<button
							type="button"
							onClick={onFindPrevious}
							aria-label={translate(msg({ message: "Previous match" }))}
							className="rounded p-1 text-muted-foreground transition-colors hover:bg-muted-foreground/20 hover:text-foreground"
						>
							<HiChevronUp className="size-3.5" />
						</button>
					</TooltipTrigger>
					<TooltipContent side="bottom">
						<Trans>Previous match</Trans> (Shift+Enter)
					</TooltipContent>
				</Tooltip>
				<Tooltip>
					<TooltipTrigger asChild>
						<button
							type="button"
							onClick={onFindNext}
							aria-label={translate(msg({ message: "Next match" }))}
							className="rounded p-1 text-muted-foreground transition-colors hover:bg-muted-foreground/20 hover:text-foreground"
						>
							<HiChevronDown className="size-3.5" />
						</button>
					</TooltipTrigger>
					<TooltipContent side="bottom">
						<Trans>Next match</Trans> (Enter)
					</TooltipContent>
				</Tooltip>
				<Tooltip>
					<TooltipTrigger asChild>
						<button
							type="button"
							onClick={onClose}
							aria-label={translate(msg({ message: "Close" }))}
							className="rounded p-1 text-muted-foreground transition-colors hover:bg-muted-foreground/20 hover:text-foreground"
						>
							<HiMiniXMark className="size-3.5" />
						</button>
					</TooltipTrigger>
					<TooltipContent side="bottom">
						<Trans>Close</Trans> (Esc)
					</TooltipContent>
				</Tooltip>
			</div>
		</div>
	);
}

import { Trans, useLingui } from "@lingui/react/macro";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@superset/ui/dropdown-menu";
import { isDataImageUri } from "@superset/ui/icons/preset-icons";
import { toast } from "@superset/ui/sonner";
import { cn } from "@superset/ui/utils";
import { Check, ChevronDown, ImagePlus } from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";

import { AGENT_ICON_OPTIONS } from "../../agent-icon-options";
import { resizeImageDataUrl } from "../../resize-image";

export interface AgentIconPickerProps {
	menuModal?: boolean;
	/**
	 * Current icon: a built-in icon key, an uploaded `data:` image URI, or null
	 * for the neutral fallback glyph.
	 */
	value: string | null;
	onChange: (iconId: string | null) => void;
	disabled?: boolean;
}

export function AgentIconPickerView({
	menuModal = false,
	renderIcon,
	selectImage,
	value,
	onChange,
	disabled,
}: AgentIconPickerProps & {
	renderIcon(props: {
		iconId?: string | null;
		presetId: string;
		className: string;
	}): ReactNode;
	selectImage(): Promise<{ canceled: boolean; dataUrl?: string | null }>;
}) {
	const { t } = useLingui();

	// Covers the whole flow (native dialog → mutate → resize), not just the
	// mutation, so re-entrant clicks can't fire overlapping selections.
	const [isProcessing, setIsProcessing] = useState(false);
	const mounted = useRef(false),
		processing = useRef(false);
	useEffect(() => {
		mounted.current = true;
		return () => {
			mounted.current = false;
		};
	}, []);
	const uploaded = value !== null && isDataImageUri(value);
	const selected = AGENT_ICON_OPTIONS.find((option) => option.id === value);

	const handleUpload = async () => {
		if (processing.current) return;
		processing.current = true;
		setIsProcessing(true);
		try {
			const result = await selectImage();
			if (!mounted.current || result.canceled || !result.dataUrl) return;
			const resized = await resizeImageDataUrl(result.dataUrl);
			if (mounted.current) onChange(resized);
		} catch {
			if (mounted.current)
				toast.error(
					t({
						message: "Failed to load image",
					}),
				);
		} finally {
			processing.current = false;
			if (mounted.current) setIsProcessing(false);
		}
	};

	const triggerLabel = uploaded ? (
		<Trans>Custom image</Trans>
	) : (
		(selected?.label ?? <Trans>No icon</Trans>)
	);

	return (
		<DropdownMenu modal={menuModal}>
			<DropdownMenuTrigger asChild>
				<button
					type="button"
					disabled={disabled || isProcessing}
					className={cn(
						"inline-flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-sm",
						"bg-transparent hover:bg-accent/50 transition-colors disabled:opacity-50",
					)}
				>
					{renderIcon({
						iconId: value,
						presetId: "custom",
						className: "size-5",
					})}
					<span className="flex-1 text-left">{triggerLabel}</span>
					<ChevronDown className="size-3.5 text-muted-foreground shrink-0" />
				</button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="start" className="w-48">
				<DropdownMenuItem
					className="gap-2"
					disabled={disabled || isProcessing}
					onSelect={(e) => {
						e.preventDefault();
						void handleUpload();
					}}
				>
					<ImagePlus className="size-4 shrink-0 text-muted-foreground" />
					<span className="flex-1">
						<Trans>Upload image…</Trans>
					</span>
					{uploaded ? <Check className="size-3.5 shrink-0" /> : null}
				</DropdownMenuItem>
				<DropdownMenuSeparator />
				<DropdownMenuItem
					className="gap-2"
					disabled={disabled || isProcessing}
					onSelect={() => onChange(null)}
				>
					{renderIcon({
						iconId: null,
						presetId: "custom",
						className: "size-4",
					})}
					<span className="flex-1">
						<Trans>No icon</Trans>
					</span>
					{value === null ? <Check className="size-3.5 shrink-0" /> : null}
				</DropdownMenuItem>
				<DropdownMenuSeparator />
				{AGENT_ICON_OPTIONS.map((option) => (
					<DropdownMenuItem
						key={option.id}
						className="gap-2"
						disabled={disabled || isProcessing}
						onSelect={() => onChange(option.id)}
					>
						{renderIcon({
							iconId: option.id,
							presetId: "custom",
							className: "size-4",
						})}
						<span className="flex-1">{option.label}</span>
						{value === option.id ? (
							<Check className="size-3.5 shrink-0" />
						) : null}
					</DropdownMenuItem>
				))}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

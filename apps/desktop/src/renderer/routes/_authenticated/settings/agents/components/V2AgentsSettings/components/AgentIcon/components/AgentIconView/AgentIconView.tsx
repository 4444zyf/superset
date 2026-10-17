import { getPresetIcon } from "@superset/ui/icons/preset-icons";
import { cn } from "@superset/ui/utils";
import { Bot } from "lucide-react";
export function AgentIconView({
	iconId,
	presetId,
	className,
	isDark,
}: {
	iconId?: string | null;
	presetId: string;
	className?: string;
	isDark: boolean;
}) {
	const icon = getPresetIcon(iconId ?? presetId, isDark);
	return icon ? (
		<img
			src={icon}
			alt=""
			className={cn("object-contain shrink-0", className)}
		/>
	) : (
		<Bot
			aria-hidden="true"
			className={cn("shrink-0 text-muted-foreground", className)}
		/>
	);
}

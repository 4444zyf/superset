import { Button } from "@superset/ui/button";
import { HiMiniCommandLine } from "react-icons/hi2";

export function PresetBarButton({
	name,
	icon,
	onClick,
	disabled = false,
	title,
}: {
	name: string;
	icon?: string;
	onClick(): void;
	disabled?: boolean;
	title?: string;
}) {
	return (
		<Button
			variant="ghost"
			size="sm"
			className="h-6 max-w-32 min-w-0 shrink-0 gap-2 rounded-md px-2 text-xs font-normal text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
			onClick={onClick}
			disabled={disabled}
			title={title}
		>
			{icon ? (
				<img
					src={icon}
					alt=""
					className="size-3.5 shrink-0 object-contain opacity-90"
				/>
			) : (
				<HiMiniCommandLine className="size-3.5 shrink-0" />
			)}
			<span className="min-w-0 truncate">{name}</span>
		</Button>
	);
}

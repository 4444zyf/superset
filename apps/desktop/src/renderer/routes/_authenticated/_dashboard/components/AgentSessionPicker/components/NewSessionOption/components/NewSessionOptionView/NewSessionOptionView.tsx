import { LuPlus } from "react-icons/lu";

export interface NewSessionOptionViewProps {
	label: string;
	presetId: string;
	iconSrc?: string;
}

export function NewSessionOptionView({
	label,
	presetId,
	iconSrc,
}: NewSessionOptionViewProps) {
	return (
		<span className="inline-flex min-w-0 items-center gap-2">
			{iconSrc ? (
				<img
					src={iconSrc}
					alt=""
					className="size-3.5 shrink-0"
					draggable={false}
				/>
			) : (
				<LuPlus className="size-3.5 shrink-0 text-muted-foreground" />
			)}
			<span className="truncate">{label}</span>
		</span>
	);
}

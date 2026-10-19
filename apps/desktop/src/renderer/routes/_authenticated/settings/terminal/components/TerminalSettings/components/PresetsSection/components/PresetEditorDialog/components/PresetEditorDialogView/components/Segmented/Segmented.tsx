interface SegmentedOption<T extends string> {
	value: T;
	label: string;
}

interface SegmentedProps<T extends string> {
	value: T;
	onChange: (value: T) => void;
	options: SegmentedOption<T>[];
	className?: string;
}

export function Segmented<T extends string>({
	value,
	onChange,
	options,
	className,
}: SegmentedProps<T>) {
	return (
		<div
			className={`inline-flex rounded-md border border-border overflow-hidden w-full ${className ?? ""}`.trim()}
		>
			{options.map((option, idx) => (
				<button
					key={option.value}
					type="button"
					onClick={() => onChange(option.value)}
					className={`flex-1 px-3 py-1 text-xs font-medium transition-colors ${
						idx > 0 ? "border-l border-border" : ""
					} ${
						value === option.value
							? "bg-accent text-accent-foreground"
							: "bg-transparent text-muted-foreground hover:bg-accent/50"
					}`}
				>
					{option.label}
				</button>
			))}
		</div>
	);
}

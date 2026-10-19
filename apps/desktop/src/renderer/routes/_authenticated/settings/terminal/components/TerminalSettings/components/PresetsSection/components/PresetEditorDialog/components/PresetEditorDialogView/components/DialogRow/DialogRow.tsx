import { Label } from "@superset/ui/label";

interface DialogRowProps {
	label: string;
	hint?: React.ReactNode;
	htmlFor?: string;
	stacked?: boolean;
	children: React.ReactNode;
}

export function DialogRow({
	label,
	hint,
	htmlFor,
	stacked,
	children,
}: DialogRowProps) {
	if (stacked) {
		return (
			<div className="py-2.5 space-y-2">
				<div className="space-y-0.5">
					<Label htmlFor={htmlFor} className="text-sm font-medium">
						{label}
					</Label>
					{hint && <p className="text-xs text-muted-foreground">{hint}</p>}
				</div>
				{children}
			</div>
		);
	}
	return (
		<div className="flex items-start justify-between gap-6 py-2.5">
			<div className="min-w-0 flex-1">
				<Label htmlFor={htmlFor} className="text-sm font-medium">
					{label}
				</Label>
				{hint && <p className="text-xs text-muted-foreground mt-0.5">{hint}</p>}
			</div>
			<div className="w-72 shrink-0">{children}</div>
		</div>
	);
}

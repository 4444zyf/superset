import type { ReactNode } from "react";
export function AgentDetailHeaderView({
	icon,
	title,
	subtitle,
}: {
	icon: ReactNode;
	title: string;
	subtitle: string;
}) {
	return (
		<div className="mb-8 flex items-center gap-3">
			{icon}
			<div className="min-w-0 flex-1">
				<h2 className="text-xl font-semibold truncate">{title}</h2>
				<p className="text-sm text-muted-foreground mt-0.5 truncate">
					{subtitle}
				</p>
			</div>
		</div>
	);
}

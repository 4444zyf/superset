import { useLingui } from "@lingui/react/macro";
import { cn } from "@superset/ui/utils";
import type { ReactNode } from "react";
import { LuCopy, LuExternalLink, LuLoaderCircle, LuX } from "react-icons/lu";
import { STROKE_WIDTH } from "renderer/screens/main/components/WorkspaceSidebar/constants";

export function PortRowView({
	port,
	description,
	address,
	title,
	isPending = false,
	externalDisabled = false,
	copyDisabled = false,
	onPrimary,
	onExternal,
	onCopy,
	onClose,
	busyActions,
}: {
	port: { port: number };
	description: string;
	address?: string;
	title?: string;
	isPending?: boolean;
	externalDisabled?: boolean;
	copyDisabled?: boolean;
	onPrimary?(): void;
	onExternal?(): void;
	onCopy?(): Promise<void>;
	onClose?(): void;
	busyActions?: ReactNode;
}) {
	const { t } = useLingui();
	const content = (
		<>
			<span className="font-medium font-mono text-foreground text-xs tabular-nums">
				:{port.port}
			</span>
			<span
				className="truncate text-[11px] text-muted-foreground"
				title={title}
			>
				{[description, address].filter(Boolean).join(" · ")}
			</span>
		</>
	);
	const primaryClass =
		"grid w-full grid-cols-[3.5rem_minmax(0,1fr)] items-center gap-2 rounded-md px-2 py-1.5 text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";
	return (
		<div
			data-port={port.port}
			className={cn(
				"group/port relative rounded-md transition-colors hover:bg-fill-hover",
				isPending && "opacity-60",
			)}
		>
			{onPrimary ? (
				<button
					type="button"
					onClick={onPrimary}
					disabled={isPending}
					className={primaryClass}
				>
					{content}
				</button>
			) : (
				<div className={primaryClass}>{content}</div>
			)}
			{busyActions && <div className="px-2 pb-1.5">{busyActions}</div>}
			<div className="absolute top-1/2 right-1.5 flex -translate-y-1/2 items-center gap-px rounded-md border border-border bg-popover/95 p-px opacity-0 transition-opacity focus-within:opacity-100 group-hover/port:opacity-100">
				{onExternal && (
					<button
						type="button"
						aria-label={t({
							message: `Open localhost:${port.port} in external browser`,
						})}
						onClick={onExternal}
						disabled={externalDisabled}
						className="rounded p-1 text-muted-foreground hover:bg-fill-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
					>
						<LuExternalLink className="size-3" strokeWidth={STROKE_WIDTH} />
					</button>
				)}
				{onCopy && (
					<button
						type="button"
						aria-label={t({ message: `Copy localhost:${port.port}` })}
						onClick={() => void onCopy()}
						disabled={copyDisabled}
						className="rounded p-1 text-muted-foreground hover:bg-fill-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
					>
						<LuCopy className="size-3" strokeWidth={STROKE_WIDTH} />
					</button>
				)}
				{onClose && (
					<button
						type="button"
						aria-label={t({ message: `Close port ${port.port}` })}
						onClick={onClose}
						disabled={isPending}
						aria-busy={isPending}
						className="rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
					>
						{isPending ? (
							<LuLoaderCircle
								className="size-3 animate-spin"
								strokeWidth={STROKE_WIDTH}
							/>
						) : (
							<LuX className="size-3" strokeWidth={STROKE_WIDTH} />
						)}
					</button>
				)}
			</div>
		</div>
	);
}

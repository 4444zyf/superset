import { Trans, useLingui } from "@lingui/react/macro";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@superset/ui/dropdown-menu";
import { cn } from "@superset/ui/utils";
import { ChevronDown, Play, Settings, Square, X } from "lucide-react";
import type { WorkspaceRunDefinition } from "shared/workspace-run-definition";

interface WorkspaceRunControlProps {
	hotkeyText?: string;
	onConfigure(): void;
	definition: WorkspaceRunDefinition | null;
	isRunning: boolean;
	isPending: boolean;
	canForceStop: boolean;
	onToggle: () => void | Promise<void>;
	onForceStop: () => void | Promise<void>;
}

export function WorkspaceRunControl({
	hotkeyText,
	onConfigure,
	definition,
	isRunning,
	isPending,
	canForceStop,
	onToggle,
	onForceStop,
}: WorkspaceRunControlProps) {
	const { t } = useLingui();
	const hasRunCommand = (definition?.commands ?? []).length > 0;

	const label = isRunning
		? t({ message: "Stop" })
		: hasRunCommand
			? t({ message: "Run" })
			: t({ message: "Set Run" });
	const Icon = isRunning ? Square : hasRunCommand ? Play : Settings;

	return (
		<div className="flex shrink-0 items-center no-drag">
			<button
				type="button"
				onClick={() => {
					if (!hasRunCommand && !isRunning) {
						onConfigure();
						return;
					}
					void onToggle();
				}}
				disabled={isPending}
				className={cn(
					"group flex h-6 items-center gap-1.5 rounded-l-md border border-r-0 border-border/50 bg-transparent px-2 text-xs font-medium text-foreground transition-colors",
					"hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
					isPending && "pointer-events-none opacity-50",
					isRunning
						? "border-emerald-500/30 bg-emerald-500/[0.08] text-emerald-400 hover:bg-emerald-500/[0.12]"
						: hasRunCommand
							? "text-foreground"
							: "text-muted-foreground/80 hover:text-foreground",
				)}
				aria-label={
					isRunning
						? t({
								message: "Stop workspace run command",
							})
						: hasRunCommand
							? t({
									message: "Run workspace command",
								})
							: t({
									message: "Configure workspace run command",
								})
				}
			>
				<Icon className="size-3 shrink-0" />
				<span>{label}</span>
				{hotkeyText && hotkeyText !== "Unassigned" && (
					<span className="hidden text-[10px] tracking-wide text-muted-foreground/60 @min-[400px]/strip:inline">
						{hotkeyText}
					</span>
				)}
			</button>

			<DropdownMenu>
				<DropdownMenuTrigger asChild>
					<button
						type="button"
						disabled={isPending}
						className={cn(
							"flex size-6 items-center justify-center rounded-r-md border border-border/50 bg-transparent text-muted-foreground transition-colors",
							"hover:bg-muted/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
							isPending && "pointer-events-none opacity-50",
							isRunning &&
								"border-emerald-500/30 bg-emerald-500/[0.08] text-emerald-400 hover:bg-emerald-500/[0.12]",
						)}
						aria-label={t({
							message: "Workspace run options",
						})}
					>
						<ChevronDown className="size-3" />
					</button>
				</DropdownMenuTrigger>
				<DropdownMenuContent align="start" className="w-44">
					{canForceStop && (
						<>
							<DropdownMenuItem
								onClick={() => void onForceStop()}
								className="text-destructive focus:text-destructive"
							>
								<X className="mr-2 size-4 text-destructive" />
								<Trans>Force Stop</Trans>
							</DropdownMenuItem>
							<DropdownMenuSeparator />
						</>
					)}
					<DropdownMenuItem onClick={onConfigure}>
						<Settings className="mr-2 size-4" />
						{definition?.source === "terminal-preset"
							? t({
									message: "Edit Run Script",
								})
							: t({
									message: "Configure",
								})}
					</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenu>
		</div>
	);
}

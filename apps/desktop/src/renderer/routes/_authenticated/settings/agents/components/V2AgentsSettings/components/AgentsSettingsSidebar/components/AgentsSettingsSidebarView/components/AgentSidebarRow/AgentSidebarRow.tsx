import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useLingui } from "@lingui/react/macro";
import type { HostAgentConfig } from "@superset/host-service/settings";
import { cn } from "@superset/ui/utils";
import type { ReactNode } from "react";
import { LuGripVertical } from "react-icons/lu";
import { settingsListItemClass } from "renderer/routes/_authenticated/settings/components/SettingsListSidebar";

interface AgentSidebarRowProps {
	renderIcon(props: {
		iconId?: string | null;
		presetId: string;
		className: string;
	}): ReactNode;
	row: HostAgentConfig;
	isActive: boolean;
	onSelect: () => void;
}

export function AgentSidebarRow({
	row,
	isActive,
	onSelect,
	renderIcon,
}: AgentSidebarRowProps) {
	const { t } = useLingui();
	const {
		setNodeRef,
		setActivatorNodeRef,
		attributes,
		listeners,
		isDragging,
		transform,
		transition,
	} = useSortable({ id: row.id });

	return (
		<div
			ref={setNodeRef}
			data-agent-config-id={row.id}
			style={{
				transform: CSS.Translate.toString(transform),
				transition,
				opacity: isDragging ? 0.5 : undefined,
			}}
			className={cn("group/row relative", isDragging && "z-10")}
		>
			<button
				type="button"
				onClick={onSelect}
				className={settingsListItemClass(isActive, "gap-2 w-full text-left")}
			>
				{renderIcon({
					iconId: row.iconId,
					presetId: row.presetId,
					className: "size-4",
				})}
				<span className="truncate flex-1">{row.label}</span>
			</button>
			<button
				type="button"
				ref={setActivatorNodeRef}
				{...attributes}
				{...listeners}
				className={cn(
					"absolute right-1 top-1/2 -translate-y-1/2 p-0.5 rounded text-muted-foreground/60 hover:text-foreground hover:bg-accent cursor-grab active:cursor-grabbing",
					"opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100 transition-opacity",
					isDragging && "opacity-100",
				)}
				aria-label={t({
					message: "Drag to reorder",
				})}
			>
				<LuGripVertical className="size-3.5" />
			</button>
		</div>
	);
}

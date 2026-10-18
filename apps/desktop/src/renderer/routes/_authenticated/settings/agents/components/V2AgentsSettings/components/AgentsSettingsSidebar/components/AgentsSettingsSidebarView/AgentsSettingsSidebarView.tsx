import {
	closestCenter,
	DndContext,
	type DragEndEvent,
	KeyboardSensor,
	MouseSensor,
	TouchSensor,
	useSensor,
	useSensors,
} from "@dnd-kit/core";
import {
	arrayMove,
	SortableContext,
	verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { Trans, useLingui } from "@lingui/react/macro";
import type { HostAgentConfig } from "@superset/host-service/settings";
import type { HostAgentPreset } from "@superset/shared/host-agent-presets";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@superset/ui/dropdown-menu";
import { Plus, Wrench } from "lucide-react";
import type { ReactNode } from "react";
import { useMemo } from "react";
import {
	SettingsListSidebar,
	settingsListItemClass,
} from "renderer/routes/_authenticated/settings/components/SettingsListSidebar";
import { AgentSidebarRow } from "./components/AgentSidebarRow/AgentSidebarRow";

export interface AgentsSettingsSidebarProps {
	configs: HostAgentConfig[];
	presets: HostAgentPreset[];
	selectedAgentId: string | null;
	onSelectAgent: (id: string) => void;
	onAddAgent: (preset: HostAgentPreset) => void;
	onCreateCustomAgent: () => void;
	onReorder: (orderedIds: string[]) => void;
	onResetToDefaults: () => void;
	isAdding: boolean;
	isResetting: boolean;
}

export function AgentsSettingsSidebarView({
	renderIcon,
	configs,
	presets,
	selectedAgentId,
	onSelectAgent,
	onAddAgent,
	onCreateCustomAgent,
	onReorder,
	onResetToDefaults,
	isAdding,
	isResetting,
}: AgentsSettingsSidebarProps & {
	renderIcon(props: {
		iconId?: string | null;
		presetId: string;
		className: string;
	}): ReactNode;
}) {
	const { t } = useLingui();
	const sortableIds = useMemo(() => configs.map((c) => c.id), [configs]);

	const sensors = useSensors(
		useSensor(MouseSensor, { activationConstraint: { distance: 4 } }),
		useSensor(TouchSensor, {
			activationConstraint: { delay: 150, tolerance: 5 },
		}),
		useSensor(KeyboardSensor),
	);

	const handleDragEnd = (event: DragEndEvent) => {
		const { active, over } = event;
		if (!over || active.id === over.id) return;
		const oldIndex = sortableIds.indexOf(String(active.id));
		const newIndex = sortableIds.indexOf(String(over.id));
		if (oldIndex < 0 || newIndex < 0) return;
		onReorder(arrayMove(sortableIds, oldIndex, newIndex));
	};

	const listHeader = (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<button
					type="button"
					disabled={isAdding}
					className={settingsListItemClass(false, "gap-2 w-full text-left")}
				>
					<Plus className="size-3.5 shrink-0" />
					<span className="truncate flex-1">
						<Trans>Add agent</Trans>
					</span>
				</button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="start" className="w-56">
				<DropdownMenuItem className="gap-2" onSelect={onCreateCustomAgent}>
					<Wrench className="size-4 shrink-0 text-muted-foreground" />
					<Trans>Custom agent…</Trans>
				</DropdownMenuItem>
				<DropdownMenuSeparator />
				{presets.map((preset) => (
					<DropdownMenuItem
						key={preset.presetId}
						onSelect={() => onAddAgent(preset)}
						className="gap-2"
					>
						{renderIcon({ presetId: preset.presetId, className: "size-4" })}
						{preset.label}
					</DropdownMenuItem>
				))}
				{presets.length > 0 ? <DropdownMenuSeparator /> : null}
				<DropdownMenuItem
					onSelect={() => onResetToDefaults()}
					disabled={isResetting}
				>
					<Trans>Reset to defaults</Trans>
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);

	return (
		<DndContext
			sensors={sensors}
			collisionDetection={closestCenter}
			onDragEnd={handleDragEnd}
		>
			<SortableContext
				items={sortableIds}
				strategy={verticalListSortingStrategy}
			>
				<SettingsListSidebar
					searchPlaceholder={t({
						message: "Filter agents...",
					})}
					searchAriaLabel={t({
						message: "Filter agents",
					})}
					listHeader={listHeader}
					groups={[
						{
							id: "all",
							title: t({
								message: "Agents",
							}),
							rows: configs,
						},
					]}
					filterRow={(row, q) =>
						row.label.toLowerCase().includes(q.toLowerCase())
					}
					getRowKey={(row) => row.id}
					emptyLabel={t({
						message: "No agents yet.",
					})}
					noMatchLabel={(q) =>
						t({
							message: `No agents match "${q}".`,
						})
					}
					renderRow={(row) => (
						<AgentSidebarRow
							renderIcon={renderIcon}
							row={row}
							isActive={row.id === selectedAgentId}
							onSelect={() => onSelectAgent(row.id)}
						/>
					)}
				/>
			</SortableContext>
		</DndContext>
	);
}

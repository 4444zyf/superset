import { Trans, useLingui } from "@lingui/react/macro";
import type { HostAgentConfig } from "@superset/host-service/settings";
import type { ExecutionMode, TerminalPreset } from "@superset/local-db";
import { Button } from "@superset/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@superset/ui/dialog";
import { Input } from "@superset/ui/input";
import { Label } from "@superset/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@superset/ui/select";
import { Switch } from "@superset/ui/switch";
import { Trash2 } from "lucide-react";
import { HiOutlineFolderOpen } from "react-icons/hi2";
import type { PresetColumnKey } from "renderer/routes/_authenticated/settings/presets/types";
import { CommandsEditor } from "renderer/routes/_authenticated/settings/terminal/components/TerminalSettings/components/PresetRow/components/CommandsEditor";
import type { AutoApplyField } from "renderer/routes/_authenticated/settings/terminal/components/TerminalSettings/components/PresetsSection/constants";
import type { PresetProjectOption } from "renderer/routes/_authenticated/settings/terminal/components/TerminalSettings/components/PresetsSection/preset-project-options";
import { ProjectTargetingField } from "../ProjectTargetingField";
import { DialogRow } from "./components/DialogRow/DialogRow";
import { Segmented } from "./components/Segmented/Segmented";
export interface PresetEditorDialogProps {
	preset: TerminalPreset | null;
	projects: PresetProjectOption[];
	/**
	 * Host-service agent configs. When provided and `preset.agentId` matches
	 * a config id, the dialog renders the linked-agent branch (read-only
	 * command + Open in Agents settings link). Older v2 rows may store presetId,
	 * so the resolver keeps a presetId fallback. v1 callers omit this — no v1
	 * row has agentId, so the linked branch stays dormant.
	 */
	agents?: HostAgentConfig[];
	/**
	 * Called after a linked-agent command save succeeds so the owner can keep
	 * the preset rows' `commands` snapshot (the launch fallback when the agent
	 * config isn't loaded) in sync with the edited command.
	 */
	onLinkedAgentSaved?: (updated: HostAgentConfig) => void;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onDeletePreset: () => void;
	onFieldChange: (column: PresetColumnKey, value: string) => void;
	onFieldBlur: (column: PresetColumnKey) => void;
	onProjectIdsChange: (projectIds: string[] | null) => void;
	onDirectorySelect: (path: string) => void;
	onCommandsChange: (commands: string[]) => void;
	onCommandsBlur: () => void;
	onModeChange: (mode: ExecutionMode) => void;
	onToggleAutoApply: (field: AutoApplyField, enabled: boolean) => void;
	onToggleWorkspaceRun: (enabled: boolean) => void;
	modeValue: ExecutionMode;
	hasMultipleCommands: boolean;
	isWorkspaceRun: boolean;
	isWorkspaceCreation: boolean;
	isNewTab: boolean;
}

interface PresetEditorDialogViewProps extends PresetEditorDialogProps {
	linkedAgent?: HostAgentConfig | null;
	linkedAgentId?: string;
	liveCommands: string[];
	linkedCommandText: string;
	onLinkedCommandChange(value: string): void;
	onLinkedCommandBlur(): void;
	linkedCommandPending?: boolean;
	agentSettingsLink?: React.ReactNode;
	preferredProjectId?: string | null;
	directoryAlert?: React.ReactNode;
	onBrowseDirectory?: () => void;
	directoryPending?: boolean;
	disabled?: boolean;
	beforeFields?: React.ReactNode;
}

export function PresetEditorDialogView({
	preset,
	projects,
	open,
	onOpenChange,
	onDeletePreset,
	onFieldChange,
	onFieldBlur,
	onProjectIdsChange,
	onCommandsChange,
	onCommandsBlur,
	onModeChange,
	onToggleAutoApply,
	onToggleWorkspaceRun,
	modeValue,
	hasMultipleCommands,
	isWorkspaceRun,
	isWorkspaceCreation,
	isNewTab,

	linkedAgent,
	linkedAgentId,
	liveCommands,
	linkedCommandText,
	onLinkedCommandChange,
	onLinkedCommandBlur,
	linkedCommandPending,
	agentSettingsLink,
	preferredProjectId,
	directoryAlert,
	onBrowseDirectory,
	directoryPending,
	disabled,
	beforeFields,
}: PresetEditorDialogViewProps) {
	const { t } = useLingui();
	const launchModeOptions = hasMultipleCommands
		? [
				{
					value: "sequential",
					label: t({
						message: "All in current tab",
					}),
				},
				{
					value: "split-pane",
					label: t({
						message: "All in current tab (split panes)",
					}),
				},
				{
					value: "new-tab",
					label: t({
						message: "Each in its own new tab",
					}),
				},
				{
					value: "new-tab-split-pane",
					label: t({
						message: "All in a new tab (split panes)",
					}),
				},
			]
		: [
				{
					value: "split-pane",
					label: t({
						message: "Open in current tab",
					}),
				},
				{
					value: "new-tab",
					label: t({
						message: "Open in new tab",
					}),
				},
			];
	const launchModeValue = hasMultipleCommands
		? modeValue
		: modeValue === "split-pane" || modeValue === "sequential"
			? "split-pane"
			: "new-tab";

	return (
		<Dialog open={open} onOpenChange={onOpenChange} modal>
			<DialogContent
				data-terminal-preset-editor
				className="sm:max-w-2xl max-h-[85vh] overflow-y-auto"
			>
				{preset ? (
					<>
						<DialogHeader>
							<DialogTitle>
								{(linkedAgent?.label ?? preset.name).trim() ||
									t({
										message: "Edit script",
									})}
							</DialogTitle>
							<DialogDescription className="sr-only">
								<Trans>
									Configure commands, availability, and launch behavior for this
									terminal script.
								</Trans>
							</DialogDescription>
						</DialogHeader>

						{beforeFields}
						<fieldset disabled={disabled} className="space-y-3">
							{linkedAgentId ? (
								<div className="py-2.5 space-y-2">
									<div className="flex items-center justify-between gap-3">
										<Label
											htmlFor={
												linkedAgent
													? `linked-command-${linkedAgent.id}`
													: undefined
											}
											className="text-sm font-medium"
										>
											<Trans>Command</Trans>
										</Label>
										{agentSettingsLink}
									</div>
									{linkedAgent ? (
										<Input
											id={`linked-command-${linkedAgent.id}`}
											className="font-mono text-xs"
											value={linkedCommandText}
											onChange={(e) => onLinkedCommandChange(e.target.value)}
											onBlur={onLinkedCommandBlur}
											disabled={linkedCommandPending}
											placeholder="claude --dangerously-skip-permissions"
										/>
									) : (
										<div className="min-w-0 rounded-md border border-border bg-muted/30 px-3 py-2 font-mono text-xs">
											{liveCommands.length > 0 ? (
												liveCommands.map((command, index) => (
													<div
														// biome-ignore lint/suspicious/noArrayIndexKey: stable order, duplicates allowed
														key={index}
														className="break-all whitespace-pre-wrap text-foreground"
													>
														{command || "—"}
													</div>
												))
											) : (
												<div className="text-foreground">—</div>
											)}
										</div>
									)}
									{!linkedAgent && (
										<p className="text-xs text-muted-foreground">
											<Trans>
												The linked agent is missing or disabled. Showing the
												snapshot.
											</Trans>
										</p>
									)}
								</div>
							) : (
								<>
									<DialogRow
										label={t({
											message: "Name",
										})}
										htmlFor="preset-name"
									>
										<Input
											id="preset-name"
											value={preset.name}
											onChange={(e) => onFieldChange("name", e.target.value)}
											onBlur={() => onFieldBlur("name")}
											placeholder={t({
												message: "e.g. Dev server",
											})}
										/>
									</DialogRow>

									<DialogRow
										label={t({
											message: "Description",
										})}
										htmlFor="preset-description"
										hint={t({
											message:
												"Optional context shown in the terminal scripts list.",
										})}
									>
										<Input
											id="preset-description"
											value={preset.description ?? ""}
											onChange={(e) =>
												onFieldChange("description", e.target.value)
											}
											onBlur={() => onFieldBlur("description")}
											placeholder={t({
												message: "Optional",
											})}
										/>
									</DialogRow>

									<DialogRow
										label={t({
											message: "Commands",
										})}
										hint={t({
											message:
												"One command per row. Add multiple to launch a grouped terminal script.",
										})}
										stacked
									>
										<CommandsEditor
											commands={preset.commands}
											onChange={onCommandsChange}
											onBlur={onCommandsBlur}
											placeholder={t({
												message: "e.g. bun run dev",
											})}
										/>
									</DialogRow>
								</>
							)}

							<DialogRow
								label={t({
									message: "Applies to",
								})}
								hint={t({
									message: "Where this terminal script is available.",
								})}
							>
								<ProjectTargetingField
									projectIds={preset.projectIds}
									projects={projects}
									preferredProjectId={preferredProjectId}
									onChange={onProjectIdsChange}
								/>
							</DialogRow>

							<DialogRow
								label={t({
									message: "Directory",
								})}
								htmlFor="preset-directory"
								hint={t({
									message:
										"Use a workspace-relative path or an absolute folder.",
								})}
							>
								<div className="flex items-center gap-2">
									<Input
										id="preset-directory"
										value={preset.cwd}
										onChange={(e) => onFieldChange("cwd", e.target.value)}
										onBlur={() => onFieldBlur("cwd")}
										placeholder="./apps/web"
										className="flex-1"
									/>
									<Button
										type="button"
										variant="outline"
										size="sm"
										onClick={onBrowseDirectory}
										disabled={directoryPending || !onBrowseDirectory}
										aria-label={t({
											message: "Browse for directory",
										})}
									>
										<HiOutlineFolderOpen className="size-4" />
									</Button>
								</div>
							</DialogRow>

							{directoryAlert && (
								<div className="px-4 pb-4">{directoryAlert}</div>
							)}

							<DialogRow
								label={t({
									message: "Launch mode",
								})}
								hint={
									hasMultipleCommands
										? t({
												message: "How grouped commands open.",
											})
										: t({
												message: "How the command opens.",
											})
								}
							>
								{hasMultipleCommands ? (
									<Select
										value={launchModeValue}
										onValueChange={(value) =>
											onModeChange(value as ExecutionMode)
										}
									>
										<SelectTrigger size="sm" className="w-full">
											<SelectValue />
										</SelectTrigger>
										<SelectContent>
											{launchModeOptions.map((option) => (
												<SelectItem key={option.value} value={option.value}>
													{option.label}
												</SelectItem>
											))}
										</SelectContent>
									</Select>
								) : (
									<Segmented
										value={launchModeValue}
										onChange={(value) => onModeChange(value as ExecutionMode)}
										options={[
											{
												value: "split-pane",
												label: t({
													message: "Current tab",
												}),
											},
											{
												value: "new-tab",
												label: t({
													message: "New tab",
												}),
											},
										]}
									/>
								)}
							</DialogRow>

							<DialogRow
								label={t({
									message: "Use as workspace run",
								})}
								htmlFor="preset-workspace-run"
								hint={t({
									message:
										"Makes the Run button launch this terminal script for matching projects.",
								})}
							>
								<div className="flex justify-end">
									<Switch
										id="preset-workspace-run"
										checked={isWorkspaceRun}
										onCheckedChange={onToggleWorkspaceRun}
									/>
								</div>
							</DialogRow>

							<DialogRow
								label={t({
									message: "Auto-run on workspace creation",
								})}
								htmlFor="preset-workspace-autostart"
								hint={t({
									message:
										"Launch this terminal script when a new workspace is created.",
								})}
							>
								<div className="flex justify-end">
									<Switch
										id="preset-workspace-autostart"
										checked={isWorkspaceCreation}
										onCheckedChange={(checked) =>
											onToggleAutoApply("applyOnWorkspaceCreated", checked)
										}
									/>
								</div>
							</DialogRow>

							<DialogRow
								label={t({
									message: "Auto-run on new tab",
								})}
								htmlFor="preset-tab-autostart"
								hint={t({
									message:
										"Launch this terminal script whenever a new terminal tab opens.",
								})}
							>
								<div className="flex justify-end">
									<Switch
										id="preset-tab-autostart"
										checked={isNewTab}
										onCheckedChange={(checked) =>
											onToggleAutoApply("applyOnNewTab", checked)
										}
									/>
								</div>
							</DialogRow>
						</fieldset>

						<DialogFooter className="sm:justify-between">
							<Button
								type="button"
								variant="ghost"
								size="sm"
								onClick={onDeletePreset}
								className="text-destructive hover:bg-destructive/10 hover:text-destructive"
							>
								<Trash2 className="size-4" />
								<Trans>Delete script</Trans>
							</Button>
							<Button
								type="button"
								size="sm"
								onClick={() => onOpenChange(false)}
							>
								<Trans>Done</Trans>
							</Button>
						</DialogFooter>
					</>
				) : null}
			</DialogContent>
		</Dialog>
	);
}

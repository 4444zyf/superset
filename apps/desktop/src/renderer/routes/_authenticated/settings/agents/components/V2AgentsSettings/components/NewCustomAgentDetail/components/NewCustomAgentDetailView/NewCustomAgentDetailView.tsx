import { Trans, useLingui } from "@lingui/react/macro";
import type { PromptTransport } from "@superset/shared/agent-prompt-launch";
import { Button } from "@superset/ui/button";
import { Input } from "@superset/ui/input";
import { type ReactNode, type Ref, useImperativeHandle, useState } from "react";
import { parseAgentCommandText } from "renderer/lib/agent-launch-command";
import { parseArgs } from "renderer/lib/argv";
import {
	AgentLaunchFields,
	Section,
	StackedField,
} from "../../../AgentFormControls/AgentFormControls";
export interface CreateCustomAgentInput {
	label: string;
	command: string;
	args: string[];
	promptTransport: PromptTransport;
	promptArgs: string[];
	resumeArgs: string[];
	forkArgs: string[];
	env: Record<string, string>;
	presetId: string;
	iconId?: string;
}

export interface NewCustomAgentDetailProps {
	onCreate: (input: CreateCustomAgentInput) => unknown;
	onCancel: () => void;
	/** True while the create request is in flight. */
	isSubmitting: boolean;
}

export interface NewCustomAgentHandle {
	isDirty(): boolean;
	save(): Promise<boolean>;
}
export function NewCustomAgentDetailView({
	renderHeader,
	renderIconPicker,
	ref,
	onDirtyChange,
	onCreate,
	onCancel,
	isSubmitting,
}: NewCustomAgentDetailProps & {
	ref?: Ref<NewCustomAgentHandle>;
	onDirtyChange?(): void;
	renderHeader(iconId: string | null, title: string): ReactNode;
	renderIconPicker(
		value: string | null,
		onChange: (v: string | null) => void,
		disabled: boolean,
	): ReactNode;
}) {
	const { t } = useLingui();
	const [label, setLabel] = useState("");
	const [iconId, setIconId] = useState<string | null>(null);
	const [commandText, setCommandText] = useState("");
	const [promptArgsText, setPromptArgsText] = useState("");
	const [resumeArgsText, setResumeArgsText] = useState("");
	const [forkArgsText, setForkArgsText] = useState("");
	const [promptTransport, setPromptTransport] =
		useState<PromptTransport>("argv");

	const trimmedLabel = label.trim();
	const parsedCommand = parseAgentCommandText(commandText);
	const canCreate =
		trimmedLabel.length > 0 &&
		parsedCommand.command.length > 0 &&
		!isSubmitting;

	const handleCreate = async () => {
		if (!canCreate) return false;
		const result = await onCreate({
			label: trimmedLabel,
			command: parsedCommand.command,
			args: parsedCommand.args,
			promptTransport,
			promptArgs: parseArgs(promptArgsText),
			resumeArgs: parseArgs(resumeArgsText),
			forkArgs: parseArgs(forkArgsText),
			env: parsedCommand.env,
			presetId: "custom",
			iconId: iconId ?? undefined,
		});
		return result !== false;
	};
	useImperativeHandle(ref, () => ({
		isDirty: () =>
			Boolean(
				label ||
					commandText ||
					promptArgsText ||
					resumeArgsText ||
					forkArgsText ||
					iconId ||
					promptTransport !== "argv",
			),
		save: handleCreate,
	}));

	return (
		<div className="p-6 max-w-3xl w-full mx-auto">
			{renderHeader(iconId, trimmedLabel || t({ message: "New agent" }))}

			<form
				className="space-y-6"
				onChange={() => onDirtyChange?.()}
				onSubmit={(e) => {
					e.preventDefault();
					void handleCreate();
				}}
			>
				<Section
					title={t({
						message: "Identity",
					})}
				>
					<StackedField
						label={t({
							message: "Label",
						})}
						htmlFor="new-agent-label"
					>
						<Input
							id="new-agent-label"
							value={label}
							onChange={(e) => setLabel(e.target.value)}
							placeholder={t({
								message: "My Agent",
							})}
							autoFocus
						/>
					</StackedField>

					<StackedField
						label={t({
							message: "Icon",
						})}
						hint={t({
							message: "Shown in launchers and this list.",
						})}
					>
						{renderIconPicker(
							iconId,
							(v) => {
								setIconId(v);
								onDirtyChange?.();
							},
							isSubmitting,
						)}
					</StackedField>
				</Section>

				<AgentLaunchFields
					idPrefix="new-agent"
					commandText={commandText}
					onCommandTextChange={setCommandText}
					promptArgsText={promptArgsText}
					onPromptArgsTextChange={setPromptArgsText}
					resumeArgsText={resumeArgsText}
					onResumeArgsTextChange={setResumeArgsText}
					forkArgsText={forkArgsText}
					onForkArgsTextChange={setForkArgsText}
					promptTransport={promptTransport}
					onPromptTransportChange={(value) => {
						setPromptTransport(value);
						onDirtyChange?.();
					}}
				/>

				<div className="flex items-center justify-end gap-2 pt-2 border-t border-border">
					<Button type="button" variant="ghost" size="sm" onClick={onCancel}>
						<Trans>Cancel</Trans>
					</Button>
					<Button type="submit" size="sm" disabled={!canCreate}>
						<Trans>Add agent</Trans>
					</Button>
				</div>
			</form>
		</div>
	);
}

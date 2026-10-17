import { Trans, useLingui } from "@lingui/react/macro";
import type { HostAgentConfig } from "@superset/host-service/settings";
import { errorMessage } from "@superset/i18n/errors";
import { Button } from "@superset/ui/button";
import { Input } from "@superset/ui/input";
import {
	type Ref,
	useContext,
	useEffect,
	useId,
	useImperativeHandle,
	useRef,
	useState,
} from "react";
import {
	getAgentCommandText,
	isAgentCommandPatchChanged,
	parseAgentCommandText,
} from "renderer/lib/agent-launch-command";
import { joinArgs, parseArgs } from "renderer/lib/argv";
import {
	AgentDetailHeader,
	AgentLaunchFields,
	Section,
} from "renderer/routes/_authenticated/settings/agents/components/V2AgentsSettings/components/AgentFormControls";
import { UnsavedChangesDialog } from "renderer/screens/main/components/WorkspaceView/ContentView/TabsContent/TabView/FileViewerPane/UnsavedChangesDialog";
import type {
	DirectDescriptor,
	DirectWorkstationApi,
} from "../../../../../../../shared/direct-workstation";
import { WorkstationEditorGuardsContext } from "../../../../providers/WorkstationEditorGuards/workstation-editor-guards";

export interface AgentConfigSnapshot {
	config: HostAgentConfig;
	revision: string;
}
export interface AgentConfigEditorHandle {
	isDirty(): boolean;
	isPending(): boolean;
	getError(): string | null;
	save(): Promise<boolean>;
}
const fieldsOf = (config: HostAgentConfig) => ({
	label: config.label,
	commandText: getAgentCommandText(config),
	promptArgsText: joinArgs(config.promptArgs),
	resumeArgsText: joinArgs(config.resumeArgs),
	forkArgsText: joinArgs(config.forkArgs),
	promptTransport: config.promptTransport,
});
type Fields = ReturnType<typeof fieldsOf>;
const patchOf = (fields: Fields) => ({
	label: fields.label.trim(),
	...parseAgentCommandText(fields.commandText),
	promptArgs: parseArgs(fields.promptArgsText),
	resumeArgs: parseArgs(fields.resumeArgsText),
	forkArgs: parseArgs(fields.forkArgsText),
	promptTransport: fields.promptTransport,
});
const matches = (config: HostAgentConfig, patch: ReturnType<typeof patchOf>) =>
	config.label === patch.label &&
	!isAgentCommandPatchChanged(config, patch) &&
	config.promptTransport === patch.promptTransport &&
	JSON.stringify(config.promptArgs) === JSON.stringify(patch.promptArgs) &&
	JSON.stringify(config.resumeArgs) === JSON.stringify(patch.resumeArgs) &&
	JSON.stringify(config.forkArgs) === JSON.stringify(patch.forkArgs);

export function AgentConfigEditor({
	api,
	connection,
	snapshot,
	onChanged,
	onReloaded,
	onPendingChange,
	ref,
}: {
	api: DirectWorkstationApi;
	connection: DirectDescriptor;
	snapshot: AgentConfigSnapshot;
	onChanged(config: HostAgentConfig): void;
	onReloaded(config: HostAgentConfig): void;
	onPendingChange(pending: boolean): void;
	ref?: Ref<AgentConfigEditorHandle>;
}) {
	const { t } = useLingui();
	const registry = useContext(WorkstationEditorGuardsContext);
	const guardId = useId();
	const errorRef = useRef<string | null>(null);
	const saveRef = useRef<() => Promise<boolean>>(async () => false);
	const base = useRef(snapshot);
	const [fields, setFields] = useState(() => fieldsOf(snapshot.config));
	const latest = useRef(fields);
	latest.current = fields;
	const dirty = useRef(false),
		pending = useRef(false),
		mounted = useRef(false),
		conflicted = useRef(false);
	const [busy, setBusy] = useState(false),
		[saved, setSaved] = useState(false),
		[error, setErrorState] = useState<string | null>(null),
		[reloadConfirm, setReloadConfirm] = useState(false);
	const setError = (message: string | null) => {
		errorRef.current = message;
		setErrorState(message);
		registry?.changed();
	};
	const callbacks = useRef({ onChanged, onReloaded, onPendingChange });
	callbacks.current = { onChanged, onReloaded, onPendingChange };
	useEffect(() => {
		mounted.current = true;
		return () => {
			mounted.current = false;
		};
	}, []);
	const rpc = <T,>(path: string, type: "query" | "mutation", input: unknown) =>
		api.rpc<T>({
			connectionId: connection.connectionId,
			generation: connection.generation,
			path: `settings.agentConfigs.${path}`,
			type,
			input,
		});
	const setPending = (value: boolean) => {
		pending.current = value;
		registry?.changed();
		setBusy(value);
		callbacks.current.onPendingChange(value);
	};
	const acknowledge = (result: AgentConfigSnapshot) => {
		base.current = result;
		dirty.current = false;
		registry?.changed();
		conflicted.current = false;
		setSaved(true);
		setError(null);
		callbacks.current.onChanged(result.config);
	};
	const save = async () => {
		if (pending.current || conflicted.current) return false;
		let patch: ReturnType<typeof patchOf>;
		try {
			patch = patchOf(latest.current);
		} catch (error) {
			setError(errorMessage(error));
			return false;
		}
		if (matches(base.current.config, patch)) {
			dirty.current = false;
			registry?.changed();
			return true;
		}
		setPending(true);
		setError(null);
		setSaved(false);
		try {
			const result = await rpc<AgentConfigSnapshot>(
				"updateWithRevisionV1",
				"mutation",
				{
					id: base.current.config.id,
					expectedRevision: base.current.revision,
					patch,
				},
			);
			if (!mounted.current) return false;
			acknowledge(result);
			return true;
		} catch (error) {
			if (!mounted.current) return false;
			try {
				const current = await rpc<AgentConfigSnapshot>(
					"getWithRevisionV1",
					"query",
					{ id: base.current.config.id },
				);
				if (!mounted.current) return false;
				if (matches(current.config, patch)) {
					acknowledge(current);
					return true;
				}
				if (current.revision !== base.current.revision) {
					conflicted.current = true;
					setError(
						t({ message: "This configuration changed. Reload before saving." }),
					);
					return false;
				}
			} catch {}
			if (mounted.current)
				setError(errorMessage(error, t({ message: "Failed to save" })));
			return false;
		} finally {
			if (mounted.current) setPending(false);
		}
	};
	saveRef.current = save;
	useEffect(
		() =>
			registry?.register({
				id: guardId,
				label: () => base.current.config.label,
				isDirty: () => dirty.current,
				isPending: () => pending.current,
				getError: () => errorRef.current,
				save: () => saveRef.current(),
			}),
		[registry, guardId],
	);
	useImperativeHandle(ref, () => ({
		isDirty: () => dirty.current,
		isPending: () => pending.current,
		getError: () => errorRef.current,
		save,
	}));
	const change = <K extends keyof Fields>(key: K, value: Fields[K]) => {
		dirty.current = true;
		registry?.changed();
		setSaved(false);
		latest.current = { ...latest.current, [key]: value };
		setFields(latest.current);
	};
	const reload = async () => {
		if (pending.current) return;
		setPending(true);
		try {
			const result = await rpc<AgentConfigSnapshot>(
				"getWithRevisionV1",
				"query",
				{ id: base.current.config.id },
			);
			if (!mounted.current) return;
			base.current = result;
			latest.current = fieldsOf(result.config);
			setFields(latest.current);
			dirty.current = false;
			conflicted.current = false;
			setError(null);
			setReloadConfirm(false);
			setSaved(false);
			callbacks.current.onReloaded(result.config);
		} catch (error) {
			if (mounted.current) setError(errorMessage(error));
		} finally {
			if (mounted.current) setPending(false);
		}
	};
	return (
		<div className="min-w-0 p-4">
			<AgentDetailHeader
				presetId={base.current.config.presetId}
				iconId={base.current.config.iconId}
				title={base.current.config.label}
				subtitle={t({ message: "Terminal agent launch configuration" })}
			/>
			{error && (
				<p role="alert" className="break-all text-sm text-destructive">
					{error}
				</p>
			)}
			<fieldset disabled={busy} className="min-w-0 space-y-6">
				<Section title={t({ message: "Label" })}>
					<Input
						aria-label={t({ message: "Label" })}
						value={fields.label}
						onChange={(e) => change("label", e.target.value)}
						onBlur={() => void save()}
					/>
				</Section>
				<AgentLaunchFields
					idPrefix={base.current.config.id}
					commandText={fields.commandText}
					onCommandTextChange={(v) => change("commandText", v)}
					onCommandBlur={() => void save()}
					promptArgsText={fields.promptArgsText}
					onPromptArgsTextChange={(v) => change("promptArgsText", v)}
					onPromptArgsBlur={() => void save()}
					resumeArgsText={fields.resumeArgsText}
					onResumeArgsTextChange={(v) => change("resumeArgsText", v)}
					onResumeArgsBlur={() => void save()}
					forkArgsText={fields.forkArgsText}
					onForkArgsTextChange={(v) => change("forkArgsText", v)}
					onForkArgsBlur={() => void save()}
					promptTransport={fields.promptTransport}
					onPromptTransportChange={(v) => {
						change("promptTransport", v);
						void save();
					}}
				/>
			</fieldset>
			<div className="mt-4 flex items-center gap-2 text-xs text-muted-foreground">
				{busy ? <Trans>Saving...</Trans> : saved ? <Trans>Saved</Trans> : null}
				{error && (
					<>
						<Button
							variant="ghost"
							size="sm"
							disabled={busy || conflicted.current}
							onClick={() => void save()}
						>
							<Trans>Retry</Trans>
						</Button>
						<Button
							variant="ghost"
							size="sm"
							disabled={busy}
							onClick={() => setReloadConfirm(true)}
						>
							<Trans>Reload</Trans>
						</Button>
					</>
				)}
			</div>
			<UnsavedChangesDialog
				open={reloadConfirm}
				onOpenChange={(open) => {
					if (!pending.current) setReloadConfirm(open);
				}}
				onDiscard={() => void reload()}
				closeOnDiscard={false}
				isSaving={busy}
				title={t({ message: "Unsaved changes" })}
				description={t({
					message: "Your changes will be lost if you don't save them.",
				})}
				discardLabel={t({ message: "Reload" })}
			/>
		</div>
	);
}

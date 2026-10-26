import { Trans, useLingui } from "@lingui/react/macro";
import { errorMessage } from "@superset/i18n/errors";
import { getPresetIcon } from "@superset/ui/icons/preset-icons";
import { toast } from "@superset/ui/sonner";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { AgentSessionSelectView } from "renderer/routes/_authenticated/_dashboard/components/AgentSessionPicker/components/AgentSessionSelect/components/AgentSessionSelectView";
import { ExistingSessionOptionView } from "renderer/routes/_authenticated/_dashboard/components/AgentSessionPicker/components/ExistingSessionOption/components/ExistingSessionOptionView";
import { NewSessionOptionView } from "renderer/routes/_authenticated/_dashboard/components/AgentSessionPicker/components/NewSessionOption/components/NewSessionOptionView";
import { useAgentSessionTarget } from "renderer/routes/_authenticated/_dashboard/components/AgentSessionPicker/hooks/useAgentSessionTarget";
import { DesignModePopoverView } from "renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/hooks/usePaneRegistry/components/BrowserPane/components/DesignModePopover/components/DesignModePopoverView";
import type { WorkspaceViewActions } from "renderer/workstation/Workstation/hooks/useWorkspaceViews/useWorkspaceViews";
import type { WorkstationBrowsers } from "renderer/workstation/Workstation/providers/WorkstationBrowsers/workstation-browsers";
import { useWorkstationAppearance } from "renderer/workstation/Workstation/providers/WorkstationPreferencesContext/WorkstationPreferencesContext";
import type { DesignModePayload } from "shared/browser-design-mode";
import type {
	DirectDescriptor,
	DirectWorkstationApi,
} from "shared/direct-workstation";
import { useAgentTargets } from "./hooks/useAgentTargets/useAgentTargets";
import { sendWorkstationDesignFeedback } from "./utils/send-feedback/send-feedback";

export function WorkspaceDesignModePopover({
	api,
	connection,
	workspaceId,
	paneId,
	id,
	runtime,
	payload,
	style,
	actions,
	onDismiss,
	onSent,
}: {
	api: DirectWorkstationApi;
	connection: DirectDescriptor;
	workspaceId: string;
	paneId: string;
	id: string;
	runtime: WorkstationBrowsers;
	payload: DesignModePayload;
	style: CSSProperties;
	actions: WorkspaceViewActions;
	onDismiss(): void;
	onSent(): void;
}) {
	const { t } = useLingui(),
		{ theme } = useWorkstationAppearance();
	const source = useAgentTargets(api, connection, workspaceId);
	const target = useAgentSessionTarget({
		sessions: source.sessions,
		configs: source.configs,
	});
	const [comment, setComment] = useState(""),
		[submitting, setSubmitting] = useState(false);
	const [sendError, setSendError] = useState<unknown>(null),
		[pickerOpen, setPickerOpen] = useState(false);
	const active = useRef(false),
		busy = useRef(false);
	const registration = useRef(runtime.registration(id)?.registrationId);
	useEffect(() => {
		active.current = true;
		return () => {
			active.current = false;
		};
	}, []);
	const current = () =>
		active.current &&
		runtime.registration(id)?.registrationId === registration.current &&
		runtime.designs.getState(id).phase === "confirming" &&
		runtime.designs.getState(id).payload === payload;
	const canSubmit =
		!!comment.trim() &&
		!submitting &&
		!source.loading &&
		!source.error &&
		!source.pending &&
		!!target.resolved;
	const submit = async () => {
		if (!canSubmit || !target.resolved || busy.current || !current()) return;
		const resolved = target.resolved;
		const selected =
			resolved.kind === "new"
				? resolved
				: {
						kind: "existing" as const,
						binding: source.sessions.find(
							(binding) => binding.terminalId === resolved.terminalId,
						)!,
					};
		if (selected.kind === "existing" && !selected.binding) return;
		busy.current = true;
		setSubmitting(true);
		setSendError(null);
		try {
			const result = await sendWorkstationDesignFeedback({
				api,
				connection,
				workspaceId,
				paneId,
				payload,
				comment,
				target: selected,
				isCurrent: current,
			});
			if (!current()) return;
			toast.success(t({ message: "Sent to agent" }));
			onSent();
			const label =
				result.label ??
				source.titles.get(result.terminalId) ??
				(selected.kind === "existing"
					? selected.binding.agentId
					: t({ message: "Terminal" }));
			void actions
				.addPane(
					workspaceId,
					{
						paneId: crypto.randomUUID(),
						kind: "terminal",
						resourceId: result.terminalId,
						...(result.executionId ? { executionId: result.executionId } : {}),
						label,
					},
					"horizontal",
					{ connection, newTab: result.placement === "new-tab" },
				)
				.catch((error) => {
					toast.error(t({ message: "An error occurred" }), {
						description: errorMessage(error),
					});
				});
		} catch (error) {
			if (current()) {
				setSendError(error);
				void source.refresh();
			}
		} finally {
			busy.current = false;
			if (active.current) setSubmitting(false);
		}
	};
	const failure = sendError ?? source.error;
	return (
		<DesignModePopoverView
			payload={payload}
			style={style}
			comment={comment}
			onCommentChange={setComment}
			submitting={submitting}
			canSubmit={canSubmit}
			onSubmit={() => {
				void submit();
			}}
			onDismiss={onDismiss}
			notice={
				failure || source.pending ? (
					<div role="alert" className="px-3 pb-1 text-xs text-destructive">
						{source.pending ? (
							<Trans>Check pending action</Trans>
						) : (
							errorMessage(failure, t({ message: "An error occurred" }))
						)}
						<button
							type="button"
							className="ml-2 underline"
							disabled={submitting || source.loading}
							onClick={() => {
								setSendError(null);
								void source.refresh();
							}}
						>
							<Trans>Retry</Trans>
						</button>
					</div>
				) : undefined
			}
			agentPicker={
				<AgentSessionSelectView
					value={target.value}
					onValueChange={target.onValueChange}
					sessions={source.sessions}
					configs={source.configs}
					titles={source.titles}
					open={pickerOpen}
					onOpenChange={(open) => {
						setPickerOpen(open);
						if (open) void source.refresh();
					}}
					renderExisting={(option) => (
						<ExistingSessionOptionView
							{...option}
							iconSrc={getPresetIcon(
								option.binding.agentId,
								theme.type === "dark",
							)}
						/>
					)}
					renderNew={(option) => (
						<NewSessionOptionView
							{...option}
							iconSrc={getPresetIcon(option.presetId, theme.type === "dark")}
						/>
					)}
				/>
			}
		/>
	);
}

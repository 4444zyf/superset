import { DesignModePopoverView } from "./components/DesignModePopoverView";
import { useLingui } from "@lingui/react/macro";
import { toast } from "@superset/ui/sonner";
import { workspaceTrpc } from "@superset/workspace-client";
import { useMemo, useState } from "react";
import { useSendToTerminalAgent } from "renderer/hooks/host-service/useSendToTerminalAgent";
import { useTerminalAgentBindings } from "renderer/hooks/host-service/useTerminalAgentBindings";
import { useWorkspaceHostUrl } from "renderer/hooks/host-service/useWorkspaceHostUrl";
import { useV2AgentConfigs } from "renderer/hooks/useV2AgentConfigs";
import {
	AgentSessionPicker,
	useAgentSessionTarget,
} from "renderer/routes/_authenticated/_dashboard/components/AgentSessionPicker";
import type { DesignModePayload } from "shared/browser-design-mode";
import { buildDesignModePrompt } from "../../designModePrompt";
import { writeDesignModeAttachments } from "../../writeDesignModeAttachments";

interface CreateNewAgentSessionInput {
	configId: string;
	placement: "split-pane" | "new-tab";
	prompt: string;
}

interface DesignModePopoverProps {
	workspaceId: string;
	/** Browser pane the element was picked in, for the live-verify hints. */
	paneId: string;
	payload: DesignModePayload;
	/** Anchoring computed by the pane (under the clicked element). */
	style: React.CSSProperties;
	/** Discard this capture and go back to picking. */
	onDismiss: () => void;
	/** Called after the prompt was delivered to an agent. */
	onSent: () => void;
	onCreateNewAgentSession?: (
		input: CreateNewAgentSessionInput,
	) => Promise<{ terminalId: string } | null>;
	/** Bring the pane hosting this agent terminal to the front. */
	onFocusAgentTerminal?: (terminalId: string) => void;
}

/**
 * Cursor-style prompt card anchored under the element the user just clicked:
 * an element chip inline with the prompt text, and one footer row with the
 * re-pick pill, the agent picker, and a round send button. The page stays
 * visible with the frozen picker highlight. New-session sends reuse the
 * last-remembered placement rather than surfacing the toggle here.
 */
export function DesignModePopover({
	workspaceId,
	paneId,
	payload,
	style,
	onDismiss,
	onSent,
	onCreateNewAgentSession,
	onFocusAgentTerminal,
}: DesignModePopoverProps) {
	const { t } = useLingui();
	const { send: sendToTerminalAgent } = useSendToTerminalAgent();
	const workspaceClient = workspaceTrpc.useUtils().client;

	const bindings = useTerminalAgentBindings(workspaceId);
	const sessions = useMemo(
		() =>
			Array.from(bindings.values()).sort(
				(a, b) => b.lastEventAt - a.lastEventAt,
			),
		[bindings],
	);
	const hostUrl = useWorkspaceHostUrl(workspaceId);
	const { data: configs = [] } = useV2AgentConfigs(hostUrl);
	const { value, resolved, onValueChange } = useAgentSessionTarget({
		sessions,
		configs,
	});

	const [comment, setComment] = useState("");
	const [submitting, setSubmitting] = useState(false);

	const canSubmit =
		comment.trim().length > 0 && !submitting && resolved != null;

	const handleSubmit = async () => {
		if (!canSubmit || !resolved) return;
		setSubmitting(true);
		try {
			let prompt: string;
			try {
				const { contextPath, screenshotPath } =
					await writeDesignModeAttachments({
						client: workspaceClient,
						workspaceId,
						paneId,
						payload,
						comment: comment.trim(),
					});
				prompt = buildDesignModePrompt({
					payload,
					comment: comment.trim(),
					contextPath,
					screenshotPath,
				});
			} catch (error) {
				toast.error(
					t({
						message: "Couldn't stage design feedback",
					}),
					{
						description: error instanceof Error ? error.message : undefined,
					},
				);
				return;
			}

			if (resolved.kind === "new") {
				if (!onCreateNewAgentSession) {
					toast.error(
						t({
							message: "Couldn't start a new agent session",
						}),
					);
					return;
				}
				const result = await onCreateNewAgentSession({
					configId: resolved.configId,
					placement: resolved.placement,
					prompt,
				});
				if (result) {
					onFocusAgentTerminal?.(result.terminalId);
					onSent();
				}
				return;
			}

			try {
				await sendToTerminalAgent({
					workspaceId,
					terminalId: resolved.terminalId,
					text: prompt,
				});
				toast.success(
					t({
						message: "Sent to agent",
					}),
				);
				onFocusAgentTerminal?.(resolved.terminalId);
				onSent();
			} catch {
				// Toast surfaced by the hook; keep the popover open for retry.
			}
		} finally {
			setSubmitting(false);
		}
	};

	return (
		<DesignModePopoverView
			payload={payload}
			style={style}
			comment={comment}
			onCommentChange={setComment}
			submitting={submitting}
			canSubmit={canSubmit}
			onSubmit={() => {
				void handleSubmit();
			}}
			onDismiss={onDismiss}
			agentPicker={
				<AgentSessionPicker
					workspaceId={workspaceId}
					value={value}
					onValueChange={onValueChange}
					sessions={sessions}
					configs={configs}
				/>
			}
		/>
	);
}

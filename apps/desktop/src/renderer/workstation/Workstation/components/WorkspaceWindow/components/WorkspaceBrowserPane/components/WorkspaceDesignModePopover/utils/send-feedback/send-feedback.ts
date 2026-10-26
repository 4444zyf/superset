import { sanitizePromptForPty } from "@superset/shared/agent-prompt-launch";
import type { RestoreResourceCheck } from "@superset/shared/workspace-restore";
import type { TerminalAgentBinding } from "renderer/hooks/host-service/useTerminalAgentBindings";
import { buildDesignModePrompt } from "renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/hooks/usePaneRegistry/components/BrowserPane/designModePrompt";
import { writeDesignModeAttachments } from "renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/hooks/usePaneRegistry/components/BrowserPane/writeDesignModeAttachments";
import type { DesignModePayload } from "shared/browser-design-mode";
import type {
	DirectDescriptor,
	DirectWorkstationApi,
} from "shared/direct-workstation";

export type DesignFeedbackTarget =
	| { kind: "existing"; binding: TerminalAgentBinding }
	| { kind: "new"; configId: string; placement: "split-pane" | "new-tab" };

export async function sendWorkstationDesignFeedback({
	api,
	connection,
	workspaceId,
	paneId,
	payload,
	comment,
	target,
	isCurrent,
}: {
	api: DirectWorkstationApi;
	connection: DirectDescriptor;
	workspaceId: string;
	paneId: string;
	payload: DesignModePayload;
	comment: string;
	target: DesignFeedbackTarget;
	isCurrent(): boolean;
}): Promise<{
	terminalId: string;
	executionId?: string;
	label?: string;
	placement?: "split-pane" | "new-tab";
}> {
	const assertCurrent = () => {
		if (!isCurrent()) throw Error("Session status unavailable.");
	};
	assertCurrent();
	if (
		connection.capabilities?.workstationAgentFeedbackV1 !== true ||
		connection.capabilities?.workstationFilesV1 !== true
	)
		throw Error("This backend does not support the required capability");
	if (!comment.trim()) throw Error("Describe the change…");
	if (
		target.kind === "new" &&
		connection.capabilities?.workstationAgentHooksV1 !== true
	)
		throw Error("This backend does not support the required capability");
	const rpc = async <T>(
		path: string,
		type: "query" | "mutation",
		input: unknown,
	): Promise<T> => {
		assertCurrent();
		const result = await api.rpc<T>({
			connectionId: connection.connectionId,
			generation: connection.generation,
			path,
			type,
			input,
		});
		assertCurrent();
		return result;
	};
	let executionId: string | undefined;
	if (target.kind === "existing") {
		if (
			target.binding.workspaceId !== workspaceId ||
			target.binding.endedAt !== undefined
		)
			throw Error("The selected agent is no longer current");
		const [checked] = await rpc<RestoreResourceCheck[]>(
			"workspace.restoreResources",
			"query",
			{
				refs: [
					{
						workspaceId,
						resourceId: target.binding.terminalId,
						kind: "terminal",
					},
				],
			},
		);
		if (checked?.state !== "live" || !checked.executionId)
			throw Error("The terminal execution is no longer current");
		executionId = checked.executionId;
	}
	const paths = await writeDesignModeAttachments({
		client: {
			workspace: {
				get: { query: (input) => rpc("workspace.get", "query", input) },
			},
			filesystem: {
				createDirectory: {
					mutate: (input) =>
						rpc("filesystem.createDirectory", "mutation", input),
				},
				writeFile: {
					mutate: (input) => rpc("filesystem.writeFile", "mutation", input),
				},
			},
		},
		workspaceId,
		paneId,
		payload,
		comment: comment.trim(),
		livePaneAvailable: false,
	});
	const prompt = buildDesignModePrompt({
		payload,
		comment: comment.trim(),
		...paths,
		livePaneAvailable: false,
	});
	const operationId = crypto.randomUUID();
	if (target.kind === "new") {
		const result = await rpc<{
			kind: string;
			sessionId: string;
			label: string;
		}>("agents.run", "mutation", {
			workspaceId,
			agent: target.configId,
			prompt,
			surface: "terminal",
			operationId,
		});
		if (result.kind !== "terminal" || !result.sessionId)
			throw Error("Selected agent isn't a terminal agent");
		return {
			terminalId: result.sessionId,
			label: result.label,
			placement: target.placement,
		};
	}
	const binding = target.binding;
	const result = await rpc<{
		terminalId: string;
		executionId: string;
		submitted: boolean;
	}>("terminal.sendToAgentV1", "mutation", {
		workspaceId,
		terminalId: binding.terminalId,
		executionId,
		agent: {
			agentId: binding.agentId,
			launchId: binding.launchId,
			startedAt: binding.startedAt,
			agentSessionId: binding.agentSessionId,
		},
		text: sanitizePromptForPty(prompt).trimEnd(),
		operationId,
	});
	if (
		!result.submitted ||
		result.terminalId !== binding.terminalId ||
		result.executionId !== executionId
	)
		throw Error("Session status unavailable.");
	return { terminalId: result.terminalId, executionId: result.executionId };
}

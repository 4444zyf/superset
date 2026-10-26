import { expect, test } from "bun:test";
import { clampDesignModePayload } from "main/lib/browser/design-mode-payload";
import type { TerminalAgentBinding } from "renderer/hooks/host-service/useTerminalAgentBindings";
import type {
	DirectDescriptor,
	DirectRpc,
	DirectWorkstationApi,
} from "shared/direct-workstation";
import {
	sendWorkstationDesignFeedback,
	type DesignFeedbackTarget,
} from "./send-feedback";

const captured = clampDesignModePayload({
	page: { sanitizedUrl: "http://localhost:3000/owned" },
	target: { tagName: "button", selector: "#owned", textSnippet: "Owned" },
});
if (!captured) throw Error("Invalid owned capture fixture");
const payload = {
	...captured,
	screenshot: {
		mimeType: "image/png" as const,
		dataUrl: "data:image/png;base64,AA==",
		width: 1,
		height: 1,
	},
};
const binding: TerminalAgentBinding = {
	terminalId: "terminal",
	workspaceId: "workspace",
	agentId: "claude",
	launchId: "launch",
	startedAt: 1,
	lastEventAt: 2,
	lastEventType: "Start",
};
const connection: DirectDescriptor = {
	connectionId: "remote",
	generation: 2,
	backendId: "backend",
	namespaceId: "namespace",
	instanceId: "instance",
	capabilities: {
		workstationAgentFeedbackV1: true,
		workstationAgentHooksV1: true,
		workstationFilesV1: true,
	},
};
function fixture(options?: {
	retireOnWorkspaceRead?: boolean;
	rejectWrite?: boolean;
	loseReceipt?: boolean;
}) {
	const calls: DirectRpc[] = [];
	let current = true;
	const api = {
		rpc: async (request: DirectRpc) => {
			calls.push(request);
			if (request.path === "workspace.restoreResources")
				return [{ state: "live", executionId: "execution" }];
			if (request.path === "workspace.get") {
				if (options?.retireOnWorkspaceRead) current = false;
				return { worktreePath: "/remote/project" };
			}
			if (request.path === "filesystem.createDirectory") return {};
			if (request.path === "filesystem.writeFile") {
				if (options?.rejectWrite) throw Error("owned write failed");
				return {};
			}
			if (request.path === "agents.run")
				return {
					kind: "terminal",
					sessionId: "new-terminal",
					label: "Owned agent",
				};
			if (request.path === "terminal.sendToAgentV1") {
				if (options?.loseReceipt) throw Error("owned receipt lost");
				return {
					terminalId: "terminal",
					executionId: "execution",
					submitted: true,
				};
			}
			throw Error(`Unexpected owned RPC: ${request.path}`);
		},
	} as unknown as DirectWorkstationApi;
	return {
		calls,
		send: (
			target: DesignFeedbackTarget = { kind: "existing", binding },
			descriptor = connection,
		) =>
			sendWorkstationDesignFeedback({
				api,
				connection: descriptor,
				workspaceId: "workspace",
				paneId: "page",
				payload,
				comment: "  中文 feedback  ",
				target,
				isCurrent: () => current,
			}),
	};
}

test("existing-agent feedback writes the original context and image on the selected machine before scoped delivery", async () => {
	const f = fixture();
	expect(await f.send()).toEqual({
		terminalId: "terminal",
		executionId: "execution",
	});
	expect(
		f.calls.every(
			(call) => call.connectionId === "remote" && call.generation === 2,
		),
	).toBe(true);
	const writes = f.calls
		.filter((call) => call.path === "filesystem.writeFile")
		.map((call) => call.input as { absolutePath: string; content: unknown });
	expect(writes).toHaveLength(2);
	expect(
		writes.every((write) =>
			write.absolutePath.startsWith(
				"/remote/project/.superset/attachments/design-",
			),
		),
	).toBe(true);
	expect(writes[0].content).toContain("**Feedback:** 中文 feedback");
	expect(writes[0].content).not.toContain("superset browser");
	expect(writes[1].content).toEqual({ kind: "base64", data: "AA==" });
	const sent = f.calls.at(-1)!;
	expect(sent.path).toBe("terminal.sendToAgentV1");
	expect(sent.input).toMatchObject({
		workspaceId: "workspace",
		terminalId: "terminal",
		executionId: "execution",
		agent: { agentId: "claude", launchId: "launch", startedAt: 1 },
	});
	expect((sent.input as { text: string }).text).toContain(
		"http://localhost:3000/owned",
	);
	expect((sent.input as { text: string }).text).not.toContain(
		"Live page section",
	);
});

test("new feedback launches through the original agent pipeline with terminal surface and remembered placement", async () => {
	const f = fixture();
	expect(
		await f.send({ kind: "new", configId: "config", placement: "new-tab" }),
	).toEqual({
		terminalId: "new-terminal",
		label: "Owned agent",
		placement: "new-tab",
	});
	const sent = f.calls.at(-1)!;
	expect(sent.path).toBe("agents.run");
	expect(sent.input).toMatchObject({
		workspaceId: "workspace",
		agent: "config",
		surface: "terminal",
	});
	expect((sent.input as { prompt: string }).prompt).toContain("中文 feedback");
	expect(
		f.calls.filter((call) => call.path === "terminal.sendToAgentV1"),
	).toEqual([]);
});

test("an older backend or a foreign agent is rejected before creating attachments", async () => {
	const f = fixture();
	await expect(
		f.send(
			{ kind: "new", configId: "config", placement: "split-pane" },
			{
				...connection,
				capabilities: {
					workstationAgentFeedbackV1: true,
					workstationFilesV1: true,
				},
			},
		),
	).rejects.toThrow("required capability");
	await expect(
		f.send(undefined, {
			...connection,
			capabilities: { workstationFilesV1: true },
		}),
	).rejects.toThrow("required capability");
	await expect(
		f.send({ kind: "existing", binding: { ...binding, workspaceId: "other" } }),
	).rejects.toThrow("selected agent is no longer current");
	expect(f.calls).toEqual([]);
});

test("a retired browser capture cannot stage files after the workspace path arrives", async () => {
	const f = fixture({ retireOnWorkspaceRead: true });
	await expect(f.send()).rejects.toThrow("Session status unavailable");
	expect(f.calls.map((call) => call.type)).toEqual(["query", "query"]);
});

test("attachment failure keeps the feedback unsent", async () => {
	const f = fixture({ rejectWrite: true });
	await expect(f.send()).rejects.toThrow("owned write failed");
	expect(
		f.calls.some((call) =>
			["terminal.sendToAgentV1", "agents.run"].includes(call.path),
		),
	).toBe(false);
});

test("an unknown send receipt is surfaced without retrying or launching a replacement", async () => {
	const f = fixture({ loseReceipt: true });
	await expect(f.send()).rejects.toThrow("owned receipt lost");
	expect(
		f.calls.filter((call) => call.path === "terminal.sendToAgentV1"),
	).toHaveLength(1);
	expect(f.calls.some((call) => call.path === "agents.run")).toBe(false);
});

import { afterEach, expect, test } from "bun:test";
import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { TooltipProvider } from "@superset/ui/tooltip";
import { clampDesignModePayload } from "main/lib/browser/design-mode-payload";
import { DesignModeStoreCore } from "renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/hooks/usePaneRegistry/components/BrowserPane/designModeStoreCore";
import type { WorkspaceViewActions } from "renderer/workstation/Workstation/hooks/useWorkspaceViews/useWorkspaceViews";
import type { WorkstationBrowsers } from "renderer/workstation/Workstation/providers/WorkstationBrowsers/workstation-browsers";
import type {
	DirectDescriptor,
	DirectRpc,
	DirectWorkstationApi,
} from "shared/direct-workstation";
import { WorkspaceDesignModePopover } from "./WorkspaceDesignModePopover";

afterEach(cleanup);
async function fixture(loseReceipt = false) {
	const payload = clampDesignModePayload({
		page: { sanitizedUrl: "http://localhost/owned" },
		target: { tagName: "button", selector: "#owned" },
	});
	if (!payload) throw Error("Invalid owned capture fixture");
	const designs = new DesignModeStoreCore(
		{
			designModeSet: { mutate: async () => ({ ok: true }) },
			designModeAwaitSelection: {
				mutate: async ({ opId }) => ({ kind: "selected", opId, payload }),
			},
			designModeScreenshot: { mutate: async () => ({ screenshot: null }) },
		},
		() => {},
	);
	await act(async () => {
		designs.toggle("id");
	});
	const captured = designs.getState("id").payload;
	if (!captured) throw Error("Owned capture did not reach confirmation");
	const calls: DirectRpc[] = [],
		panes: unknown[] = [];
	let sent = 0,
		pending = false;
	const connection: DirectDescriptor = {
		connectionId: "remote",
		generation: 2,
		backendId: "backend",
		namespaceId: "namespace",
		instanceId: "instance",
		capabilities: {
			workstationAgentFeedbackV1: true,
			workstationFilesV1: true,
		},
	};
	const api = {
		listPending: async () =>
			pending
				? [
						{
							operationId: "owned-operation",
							procedure: "terminal.sendToAgentV1",
						},
					]
				: [],
		rpc: async (request: DirectRpc) => {
			calls.push(request);
			switch (request.path) {
				case "terminalAgents.listByWorkspace":
					return [
						{
							terminalId: "terminal",
							workspaceId: "workspace",
							agentId: "claude",
							startedAt: 1,
							lastEventAt: 2,
							lastEventType: "Start",
						},
					];
				case "settings.agentConfigs.list":
					return [];
				case "terminal.list":
					return {
						sessions: [{ terminalId: "terminal", title: "Owned agent" }],
					};
				case "workspace.restoreResources":
					return [{ state: "live", executionId: "execution" }];
				case "workspace.get":
					return { worktreePath: "/remote/project" };
				case "filesystem.createDirectory":
				case "filesystem.writeFile":
					return {};
				case "terminal.sendToAgentV1":
					if (loseReceipt) {
						pending = true;
						throw Error("owned receipt lost");
					}
					return {
						terminalId: "terminal",
						executionId: "execution",
						submitted: true,
					};
				default:
					throw Error(`Unexpected owned RPC ${request.path}`);
			}
		},
	} as unknown as DirectWorkstationApi;
	const runtime = {
		registration: () => ({ registrationId: "owned-registration" }),
		designs,
	} as unknown as WorkstationBrowsers;
	const actions = {
		addPane: async (...args: unknown[]) => {
			panes.push(args);
			return null;
		},
	} as unknown as WorkspaceViewActions;
	render(
		<TooltipProvider>
			<WorkspaceDesignModePopover
				api={api}
				connection={connection}
				workspaceId="workspace"
				paneId="page"
				id="id"
				runtime={runtime}
				payload={captured}
				style={{ top: 0, left: 0 }}
				actions={actions}
				onDismiss={() => designs.rearm("id")}
				onSent={() => {
					sent++;
					designs.exit("id");
				}}
			/>
		</TooltipProvider>,
	);
	await screen.findByText("Owned agent");
	return { calls, panes, sent: () => sent };
}

test("the original feedback form sends to the selected agent once and reveals its existing execution", async () => {
	const f = await fixture();
	const input = screen.getByPlaceholderText("Describe the change…");
	fireEvent.change(input, { target: { value: "中文 change" } });
	await waitFor(() =>
		expect(
			screen
				.getByRole("button", { name: "Send to agent" })
				.hasAttribute("disabled"),
		).toBe(false),
	);
	fireEvent.keyDown(input, { key: "Enter" });
	fireEvent.keyDown(input, { key: "Enter" });
	await waitFor(() => expect(f.sent()).toBe(1));
	expect(
		f.calls.filter((call) => call.path === "terminal.sendToAgentV1"),
	).toHaveLength(1);
	expect(
		f.calls.some((call) =>
			["agents.run", "terminal.createSession"].includes(call.path),
		),
	).toBe(false);
	expect(f.panes).toHaveLength(1);
	expect((f.panes[0] as unknown[])[1]).toMatchObject({
		kind: "terminal",
		resourceId: "terminal",
		executionId: "execution",
		label: "Owned agent",
	});
});

test("an unresolved send keeps the comment and disables resubmission without acknowledging or replacing the agent", async () => {
	const f = await fixture(true);
	const input = screen.getByPlaceholderText("Describe the change…");
	fireEvent.change(input, { target: { value: "keep this feedback" } });
	await waitFor(() =>
		expect(
			screen
				.getByRole("button", { name: "Send to agent" })
				.hasAttribute("disabled"),
		).toBe(false),
	);
	fireEvent.click(screen.getByRole("button", { name: "Send to agent" }));
	await screen.findByText("Check pending action");
	expect((input as HTMLTextAreaElement).value).toBe("keep this feedback");
	expect(
		screen
			.getByRole("button", { name: "Send to agent" })
			.hasAttribute("disabled"),
	).toBe(true);
	fireEvent.keyDown(input, { key: "Enter" });
	fireEvent.click(screen.getByRole("button", { name: "Retry" }));
	await waitFor(() =>
		expect(
			screen.getByRole("button", { name: "Retry" }).hasAttribute("disabled"),
		).toBe(false),
	);
	expect(
		f.calls.filter((call) => call.path === "terminal.sendToAgentV1"),
	).toHaveLength(1);
	expect(f.sent()).toBe(0);
	expect(f.panes).toEqual([]);
});

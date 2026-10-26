import { afterEach, expect, test } from "bun:test";
import { act, cleanup, renderHook } from "@testing-library/react";
import type { TerminalAgentBinding } from "renderer/hooks/host-service/useTerminalAgentBindings";
import type {
	DirectDescriptor,
	DirectRpc,
	DirectWorkstationApi,
} from "shared/direct-workstation";
import { useAgentTargets } from "./useAgentTargets";

afterEach(cleanup);
const descriptor = (connectionId: string): DirectDescriptor => ({
	connectionId,
	generation: 1,
	backendId: "backend",
	namespaceId: "namespace",
	instanceId: "instance",
	capabilities: { workstationAgentFeedbackV1: true },
});
const binding = (terminalId: string): TerminalAgentBinding => ({
	terminalId,
	workspaceId: "workspace",
	agentId: "claude",
	startedAt: 1,
	lastEventAt: 2,
	lastEventType: "Start",
});

test("an old machine's late agent list cannot replace the selected machine's targets", async () => {
	const first = Promise.withResolvers<TerminalAgentBinding[]>(),
		second = Promise.withResolvers<TerminalAgentBinding[]>();
	const api = {
		listPending: async () => [],
		rpc: async (request: DirectRpc) => {
			if (request.path === "terminalAgents.listByWorkspace")
				return request.connectionId === "first"
					? first.promise
					: second.promise;
			if (request.path === "terminal.list") return { sessions: [] };
			return [];
		},
	} as unknown as DirectWorkstationApi;
	const hook = renderHook(
		({ connection }) => useAgentTargets(api, connection, "workspace"),
		{ initialProps: { connection: descriptor("first") } },
	);
	await act(async () => {
		hook.rerender({ connection: descriptor("second") });
	});
	await act(async () => {
		second.resolve([binding("selected")]);
	});
	expect(hook.result.current.sessions.map((row) => row.terminalId)).toEqual([
		"selected",
	]);
	await act(async () => {
		first.resolve([binding("old")]);
	});
	expect(hook.result.current.sessions.map((row) => row.terminalId)).toEqual([
		"selected",
	]);
});

test("agent read failure remains an error and readonly refresh can recover to a real empty list", async () => {
	let failed = true;
	const api = {
		listPending: async () => [],
		rpc: async (request: DirectRpc) => {
			if (request.path === "terminalAgents.listByWorkspace" && failed)
				throw Error("owned read failed");
			return request.path === "terminal.list" ? { sessions: [] } : [];
		},
	} as unknown as DirectWorkstationApi;
	const connection = descriptor("owned");
	const hook = renderHook(() => useAgentTargets(api, connection, "workspace"));
	await act(async () => {});
	expect(String(hook.result.current.error)).toContain("owned read failed");
	failed = false;
	await act(async () => {
		await hook.result.current.refresh();
	});
	expect(hook.result.current.error).toBeNull();
	expect(hook.result.current.loading).toBe(false);
	expect(hook.result.current.sessions).toEqual([]);
});

import type { HostAgentConfig } from "@superset/host-service/settings";
import { useCallback, useEffect, useRef, useState } from "react";
import type { TerminalAgentBinding } from "renderer/hooks/host-service/useTerminalAgentBindings";
import type {
	DirectDescriptor,
	DirectWorkstationApi,
} from "shared/direct-workstation";

interface AgentTargets {
	owner: string;
	loading: boolean;
	error: unknown;
	sessions: TerminalAgentBinding[];
	configs: HostAgentConfig[];
	titles: ReadonlyMap<string, string | null>;
	pending: number;
}

export function useAgentTargets(
	api: DirectWorkstationApi,
	connection: DirectDescriptor,
	workspaceId: string,
) {
	const owner = JSON.stringify([
		connection.connectionId,
		connection.generation,
		connection.backendId,
		connection.namespaceId,
		connection.instanceId,
		workspaceId,
	]);
	const serial = useRef(0),
		active = useRef(false),
		selected = useRef(owner);
	selected.current = owner;
	const empty: AgentTargets = {
		owner,
		loading: true,
		error: null,
		sessions: [],
		configs: [],
		titles: new Map(),
		pending: 0,
	};
	const [state, setState] = useState<AgentTargets>(empty);
	const refresh = useCallback(async () => {
		if (!active.current) return;
		const request = ++serial.current;
		const current = () =>
			active.current &&
			selected.current === owner &&
			serial.current === request;
		setState((previous) =>
			previous.owner === owner
				? { ...previous, loading: true, error: null }
				: {
						owner,
						loading: true,
						error: null,
						sessions: [],
						configs: [],
						titles: new Map(),
						pending: 0,
					},
		);
		try {
			if (connection.capabilities?.workstationAgentFeedbackV1 !== true)
				throw Error("This backend does not support the required capability");
			const query = <T>(path: string, input?: unknown) =>
				api.rpc<T>({
					connectionId: connection.connectionId,
					generation: connection.generation,
					path,
					type: "query",
					input,
				});
			const [bindings, configs, terminals, pending] = await Promise.all([
				query<TerminalAgentBinding[]>("terminalAgents.listByWorkspace", {
					workspaceId,
				}),
				query<HostAgentConfig[]>("settings.agentConfigs.list"),
				query<{ sessions: { terminalId: string; title?: string | null }[] }>(
					"terminal.list",
					{ workspaceId },
				),
				api.listPending(connection.connectionId),
			]);
			if (!current()) return;
			setState({
				owner,
				loading: false,
				error: null,
				sessions: bindings
					.filter(
						(binding) =>
							binding.workspaceId === workspaceId &&
							binding.endedAt === undefined,
					)
					.sort((a, b) => b.lastEventAt - a.lastEventAt),
				configs,
				titles: new Map(
					terminals.sessions.map((terminal) => [
						terminal.terminalId,
						terminal.title ?? null,
					]),
				),
				pending: pending.length,
			});
		} catch (error) {
			if (current())
				setState({
					owner,
					loading: false,
					error,
					sessions: [],
					configs: [],
					titles: new Map(),
					pending: 0,
				});
		}
	}, [api, connection, owner, workspaceId]);
	useEffect(() => {
		active.current = true;
		void refresh();
		const onFocus = () => {
			void refresh();
		};
		window.addEventListener("focus", onFocus);
		return () => {
			active.current = false;
			serial.current++;
			window.removeEventListener("focus", onFocus);
		};
	}, [refresh]);
	return { ...(state.owner === owner ? state : empty), refresh };
}

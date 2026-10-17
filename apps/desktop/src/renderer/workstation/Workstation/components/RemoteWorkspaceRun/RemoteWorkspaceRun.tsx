import { Trans } from "@lingui/react/macro";
import type { AppRouter } from "@superset/host-service";
import { errorMessage, rawErrorMessage } from "@superset/i18n/errors";
import { Button } from "@superset/ui/button";
import type { inferRouterOutputs } from "@trpc/server";
import { useEffect, useRef, useState } from "react";
import { WorkspaceRunControl } from "renderer/components/WorkspaceRunControl";
import type {
	DirectDescriptor,
	DirectWorkstationApi,
} from "../../../../../shared/direct-workstation";

function displayRunError(error: unknown): string {
	const raw = rawErrorMessage(error);
	const message = raw.replace(
		/^Error invoking remote method '[^']+': (?:Error:\s*)?/,
		"",
	);
	return errorMessage(message !== raw ? new Error(message) : error);
}

type Snapshot = inferRouterOutputs<AppRouter>["workspaceRun"]["getStateV1"];
export type RemoteRun = NonNullable<Snapshot["run"]>;
export function RemoteWorkspaceRun({
	api,
	connection,
	workspaceId,
	onConfigure,
	onAttach,
	canStart = true,
	pollMs = 1500,
}: {
	api: DirectWorkstationApi;
	connection: DirectDescriptor;
	workspaceId: string;
	onConfigure(projectId: string): void;
	onAttach(run: RemoteRun): Promise<void>;
	canStart?: boolean;
	pollMs?: number;
}) {
	const owner = JSON.stringify([
		connection.connectionId,
		connection.backendId,
		connection.namespaceId,
		connection.generation,
		workspaceId,
	]);
	const ownerRef = useRef(owner);
	ownerRef.current = owner;
	const mountedOwner = useRef<string | null>(null);
	const [loaded, setLoaded] = useState<{
		owner: string;
		value: Snapshot;
	} | null>(null);
	const [pending, setPending] = useState(false);
	const [blocked, setBlocked] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const pendingRef = useRef(false),
		reading = useRef(false),
		fence = useRef(0),
		attached = useRef<string | null>(null);
	const callbacks = useRef({ onAttach, onConfigure });
	callbacks.current = { onAttach, onConfigure };
	const capable =
		connection.capabilities?.workstationWorkspaceRunV1 === true &&
		connection.capabilities.durableOperations === true;
	const owned = () =>
		ownerRef.current === owner && mountedOwner.current === owner;
	const query = () =>
		api.rpc<Snapshot>({
			connectionId: connection.connectionId,
			generation: connection.generation,
			path: "workspaceRun.getStateV1",
			type: "query",
			input: { workspaceId },
		});
	const install = async (value: Snapshot) => {
		if (!owned()) return;
		setLoaded({ owner, value });
		if (value.definitionError) setError(value.definitionError);
		const run = value.run;
		if (
			run &&
			(run.state === "active" ||
				(run.state === "ended" && run.exitCode !== undefined)) &&
			run.executionId
		) {
			const key = `${run.operationId}:${run.executionId}`;
			if (attached.current !== key) {
				attached.current = key;
				await callbacks.current.onAttach(run);
			}
		}
	};
	const refresh = async () => {
		if (reading.current || pendingRef.current || !owned() || !capable) return;
		reading.current = true;
		const captured = fence.current;
		try {
			const value = await query();
			if (owned() && captured === fence.current) await install(value);
		} catch (err) {
			if (owned() && captured === fence.current) setError(displayRunError(err));
		} finally {
			if (owned()) reading.current = false;
		}
	};
	const refreshRef = useRef(refresh);
	refreshRef.current = refresh;
	useEffect(() => {
		mountedOwner.current = owner;
		reading.current = false;
		pendingRef.current = false;
		attached.current = null;
		fence.current++;
		setLoaded(null);
		setPending(false);
		setBlocked(false);
		setError(null);
		if (capable) void refreshRef.current();
		const timer = capable
			? setInterval(() => void refreshRef.current(), pollMs)
			: undefined;
		return () => {
			if (timer) clearInterval(timer);
			if (mountedOwner.current === owner) mountedOwner.current = null;
		};
	}, [api, owner, capable, pollMs]);
	const data = loaded?.owner === owner ? loaded.value : null;
	const running = !!data?.run && data.run.state !== "ended";
	const exitCode = data?.run?.state === "ended" ? data.run.exitCode : undefined;
	const act = async (force = false) => {
		if (pendingRef.current || blocked || !owned() || !data || !capable) return;
		const run = data.run;
		const stopping = run && run.state !== "ended";
		if (stopping && !run.executionId) return;
		if (!stopping && (!canStart || !data.definitionVersion)) return;
		pendingRef.current = true;
		setPending(true);
		setError(null);
		fence.current++;
		const operationId = crypto.randomUUID();
		let attempted = false;
		let selected = data;
		try {
			if (!stopping) {
				const fresh = await query();
				if (!owned()) return;
				await install(fresh);
				if (fresh.run && fresh.run.state !== "ended") return;
				if (!fresh.definitionVersion) return;
				selected = fresh;
			}
			attempted = true;
			const result = await api.rpc<RemoteRun>({
				connectionId: connection.connectionId,
				generation: connection.generation,
				path: stopping ? "workspaceRun.stopV1" : "workspaceRun.startV1",
				type: "mutation",
				input: stopping
					? {
							workspaceId,
							operationId,
							runOperationId: run.operationId,
							executionId: run.executionId,
							force,
						}
					: {
							workspaceId,
							operationId,
							definitionVersion: selected.definitionVersion,
						},
			});
			if (!owned()) return;
			await install({ ...selected, run: result });
		} catch (err) {
			if (!owned()) return;
			setBlocked(attempted);
			setError(displayRunError(err));
			if (attempted)
				try {
					await install(await query());
				} catch {}
		} finally {
			if (owned()) {
				pendingRef.current = false;
				setPending(false);
			}
		}
	};
	const reconcile = async () => {
		if (pendingRef.current || !owned()) return;
		pendingRef.current = true;
		setPending(true);
		fence.current++;
		try {
			await api.reconcile(connection.connectionId);
			if (!owned()) return;
			const pendingActions = await api.listPending(connection.connectionId);
			if (!owned()) return;
			await install(await query());
			if (!owned()) return;
			setBlocked(pendingActions.length > 0);
			if (!pendingActions.length) setError(null);
		} catch (err) {
			if (owned()) setError(displayRunError(err));
		} finally {
			if (owned()) {
				pendingRef.current = false;
				setPending(false);
			}
		}
	};
	if (!capable) return null;
	return (
		<div data-workspace-run className="flex items-center gap-2 min-w-0">
			{data?.projectId && (
				<WorkspaceRunControl
					definition={data.definition}
					isRunning={running}
					isPending={
						pending ||
						blocked ||
						(running && !data.run?.executionId) ||
						(!running && !canStart)
					}
					canForceStop={running && !!data.run?.executionId}
					onConfigure={() => {
						const projectId = data?.projectId;
						if (owned() && projectId) callbacks.current.onConfigure(projectId);
					}}
					onToggle={() => act()}
					onForceStop={() => act(true)}
				/>
			)}
			{exitCode !== undefined && (
				<output
					role="status"
					data-run-exit-code={exitCode}
					className={
						exitCode === 0
							? "text-xs text-muted-foreground"
							: "text-xs text-destructive"
					}
				>
					{exitCode === 0 ? (
						<Trans>Completed</Trans>
					) : (
						<Trans>Run exited with code {exitCode}</Trans>
					)}
				</output>
			)}
			{error && (
				<span
					role="alert"
					className="text-xs text-destructive max-w-64 truncate"
					title={error}
				>
					{error}
				</span>
			)}
			{data?.run?.state === "unknown" && (
				<span className="text-xs text-muted-foreground">
					<Trans>Unknown</Trans>
				</span>
			)}
			{(error || blocked || data?.run?.state === "unknown") && (
				<Button
					variant="ghost"
					size="sm"
					disabled={pending}
					onClick={() => void reconcile()}
				>
					{blocked ? (
						<Trans>Check pending action</Trans>
					) : (
						<Trans>Refresh</Trans>
					)}
				</Button>
			)}
		</div>
	);
}

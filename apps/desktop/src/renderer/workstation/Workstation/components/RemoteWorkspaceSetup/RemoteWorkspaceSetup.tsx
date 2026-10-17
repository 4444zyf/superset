import { Trans } from "@lingui/react/macro";
import type { AppRouter } from "@superset/host-service";
import { errorMessage } from "@superset/i18n/errors";
import { Badge } from "@superset/ui/badge";
import { Button } from "@superset/ui/button";
import type { inferRouterOutputs } from "@trpc/server";
import { useEffect, useRef, useState } from "react";
import type {
	DirectDescriptor,
	DirectWorkstationApi,
} from "../../../../../shared/direct-workstation";
export type RemoteSetup = NonNullable<
	inferRouterOutputs<AppRouter>["workspaceSetup"]["getStateV1"]
>;
export function RemoteWorkspaceSetup({
	api,
	connection,
	workspaceId,
	onOpen,
	pollMs = 1500,
}: {
	api: DirectWorkstationApi;
	connection: DirectDescriptor;
	workspaceId: string;
	onOpen?(setup: RemoteSetup): Promise<void> | void;
	pollMs?: number;
}) {
	const owner = JSON.stringify([
		connection.connectionId,
		connection.backendId,
		connection.namespaceId,
		connection.generation,
		workspaceId,
	]);
	const [loaded, setLoaded] = useState<{
		owner: string;
		value: RemoteSetup | null;
		error?: string;
		openError?: string;
	} | null>(null);
	const [refresh, setRefresh] = useState(0);
	const alive = useRef<() => boolean>(() => false);
	const capable = connection.capabilities?.workstationWorkspaceSetupV1 === true;
	useEffect(() => {
		if (!capable) return;
		let active = true,
			reading = false;
		alive.current = () => active;
		const read = async () => {
			if (reading) return;
			reading = true;
			try {
				const value = await api.rpc<RemoteSetup | null>({
					connectionId: connection.connectionId,
					generation: connection.generation,
					path: "workspaceSetup.getStateV1",
					type: "query",
					input: { workspaceId },
				});
				if (active)
					setLoaded((current) => ({
						owner,
						value,
						openError:
							current?.owner === owner &&
							current.value?.terminalId === value?.terminalId
								? current.openError
								: undefined,
					}));
			} catch (error) {
				if (active)
					setLoaded({ owner, value: null, error: errorMessage(error) });
			} finally {
				reading = false;
			}
		};
		void read();
		const timer = setInterval(() => void read(), pollMs);
		return () => {
			active = false;
			clearInterval(timer);
		};
	}, [api, owner, capable, pollMs, refresh]);
	if (
		!capable ||
		loaded?.owner !== owner ||
		(!loaded.value && !loaded.error && !loaded.openError)
	)
		return null;
	const setup = loaded.value;
	return (
		<div
			data-workspace-setup
			data-setup-phase={setup?.phase ?? "unknown"}
			data-setup-exit-code={setup?.exitCode}
			className="flex items-center gap-2 min-w-0 text-xs"
		>
			{setup && (
				<Badge
					variant={setup.phase === "failed" ? "destructive" : "secondary"}
					role="status"
				>
					<Trans>Setup</Trans> ·{" "}
					{setup.phase === "succeeded" ? (
						<Trans>Completed</Trans>
					) : setup.phase === "failed" ? (
						<Trans>Failed</Trans>
					) : setup.phase === "cancelled" ? (
						<Trans>Cancelled</Trans>
					) : setup.phase === "running" || setup.phase === "launching" ? (
						<Trans>In progress</Trans>
					) : (
						<Trans>Unknown</Trans>
					)}
					{setup.exitCode !== undefined ? ` (${setup.exitCode})` : null}
				</Badge>
			)}
			{(loaded.error || loaded.openError || setup?.warning) && (
				<span
					role="alert"
					className="max-w-64 truncate text-destructive"
					title={loaded.error ?? loaded.openError ?? setup?.warning}
				>
					{loaded.error ??
						loaded.openError ??
						errorMessage(setup?.warning ?? "")}
				</span>
			)}
			{setup?.executionId && onOpen && (
				<Button
					type="button"
					variant="ghost"
					size="sm"
					onClick={() => {
						const isActive = alive.current;
						void (async () => {
							try {
								await onOpen(setup);
							} catch (error) {
								if (isActive())
									setLoaded((value) =>
										value?.owner === owner
											? { ...value, openError: errorMessage(error) }
											: value,
									);
							}
						})();
					}}
				>
					<Trans>Show output</Trans>
				</Button>
			)}
			{(loaded.error || loaded.openError || setup?.phase === "unknown") && (
				<Button
					type="button"
					variant="ghost"
					size="sm"
					onClick={() => {
						setLoaded((value) =>
							value
								? { ...value, error: undefined, openError: undefined }
								: value,
						);
						setRefresh((n) => n + 1);
					}}
				>
					<Trans>Refresh</Trans>
				</Button>
			)}
		</div>
	);
}

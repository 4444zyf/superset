import { msg, plural } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { i18n } from "@superset/i18n";
import { errorMessage } from "@superset/i18n/errors";
import { Button } from "@superset/ui/button";
import { useEffect, useRef, useState } from "react";
import { confirmClosePorts } from "renderer/hooks/ports/usePortKillActions/confirmClosePorts";
import { PortRowView } from "renderer/routes/_authenticated/_dashboard/components/PortsDropdown/components/PortRow/components/PortRowView";
import { PortsFooterView } from "renderer/routes/_authenticated/_dashboard/components/PortsDropdown/components/PortsFooter/components/PortsFooterView";
import type {
	DirectDescriptor,
	DirectPort,
	DirectWorkstationApi,
} from "../../../../../shared/direct-workstation";

export function RemoteWorkspacePorts({
	api,
	connection,
	workspaceId,
	busy,
	onOpenPort,
	onOpenPortExternal,
	onCopyPort,
	pollMs = 2000,
	confirmClose = confirmClosePorts,
}: {
	api: DirectWorkstationApi;
	connection: DirectDescriptor;
	workspaceId: string;
	busy: boolean;
	onOpenPort(port: number): void;
	onOpenPortExternal?(port: number): void;
	onCopyPort?(port: number): Promise<void>;
	pollMs?: number;
	confirmClose?(count: number): Promise<boolean>;
}) {
	const owner = JSON.stringify([
		connection.connectionId,
		connection.backendId,
		connection.namespaceId,
		connection.instanceId,
		connection.generation,
		workspaceId,
	]);
	const available =
		connection.capabilities?.workstationPortsV1 === true &&
		typeof api.listPorts === "function";
	const current = useRef({
		api,
		owner,
		available,
		busy,
		onOpenPort,
		onOpenPortExternal,
		onCopyPort,
	});
	current.current = {
		api,
		owner,
		available,
		busy,
		onOpenPort,
		onOpenPortExternal,
		onCopyPort,
	};
	const mounted = useRef(false);
	const readNow = useRef<(() => void) | null>(null);
	const closingRef = useRef<{
		api: DirectWorkstationApi;
		owner: string;
	} | null>(null);
	const [closing, setClosing] = useState<{
		api: DirectWorkstationApi;
		owner: string;
	} | null>(null);
	const [closeError, setCloseError] = useState<{
		api: DirectWorkstationApi;
		owner: string;
		message: string;
	} | null>(null);
	const isClosing = closing?.api === api && closing.owner === owner;
	const closePorts = async (ports: DirectPort[]) => {
		const kill = api.killWorkspacePort;
		const isCurrent = () =>
			mounted.current &&
			current.current.api === api &&
			current.current.owner === owner &&
			current.current.available;
		if (
			!kill ||
			!isCurrent() ||
			current.current.busy ||
			ports.length === 0 ||
			ports.some((port) => port.workspaceId !== workspaceId) ||
			(closingRef.current?.api === api && closingRef.current.owner === owner)
		)
			return;
		const token = { api, owner };
		closingRef.current = token;
		setClosing(token);
		setCloseError(null);
		try {
			if (
				!(await confirmClose(ports.length)) ||
				!isCurrent() ||
				current.current.busy
			)
				return;
			const results = await Promise.all(
				ports.map(async (port) => {
					try {
						return await kill.call(
							api,
							connection,
							workspaceId,
							port.terminalId,
							port.port,
						);
					} catch (error) {
						return { success: false, error: errorMessage(error) };
					}
				}),
			);
			if (!isCurrent()) return;
			readNow.current?.();
			const failed = results.flatMap((result, index) =>
				result?.success === true
					? []
					: [{ port: ports[index], error: result?.error }],
			);
			if (failed.length) {
				const first = failed[0];
				if (ports.length === 1)
					throw new Error(
						first?.error ||
							i18n._(
								msg({ message: `Failed to close port ${ports[0]?.port}` }),
							),
					);
				throw new Error(
					i18n._(
						msg({
							message: plural(failed.length, {
								one: "Failed to close # port",
								other: "Failed to close # ports",
							}),
						}),
					) + (first?.error ? `\n${first.error}` : ""),
				);
			}
		} catch (error) {
			if (isCurrent())
				setCloseError({ api, owner, message: errorMessage(error) });
		} finally {
			if (closingRef.current === token) {
				closingRef.current = null;
				if (mounted.current) setClosing((old) => (old === token ? null : old));
			}
		}
	};
	const [readingState, setReadingState] = useState<{
		api: DirectWorkstationApi;
		owner: string;
		reading: boolean;
	} | null>(null);
	const [loaded, setLoaded] = useState<{
		api: DirectWorkstationApi;
		owner: string;
		ports: DirectPort[];
		error?: string;
	} | null>(null);
	useEffect(() => {
		const list = api.listPorts;
		if (!available || !list) return;
		let active = true,
			reading = false;
		mounted.current = true;
		const read = async () => {
			if (
				!active ||
				reading ||
				current.current.api !== api ||
				current.current.owner !== owner ||
				!current.current.available
			)
				return;
			reading = true;
			setReadingState({ api, owner, reading: true });
			try {
				const value = await list.call(api, connection, workspaceId);
				if (!Array.isArray(value))
					throw new Error(i18n._(msg({ message: "Unable to load ports" })));
				const ports = value
					.filter(
						(port) =>
							port &&
							typeof port === "object" &&
							port.workspaceId === workspaceId &&
							Number.isSafeInteger(port.port) &&
							port.port > 0 &&
							port.port <= 65535 &&
							typeof port.terminalId === "string" &&
							typeof port.processName === "string" &&
							(port.label === null || typeof port.label === "string"),
					)
					.sort(
						(a, b) =>
							a.port - b.port || a.terminalId.localeCompare(b.terminalId),
					);
				if (active) setLoaded({ api, owner, ports });
			} catch (error) {
				if (active)
					setLoaded((old) => ({
						api,
						owner,
						ports: old?.api === api && old.owner === owner ? old.ports : [],
						error: errorMessage(error),
					}));
			} finally {
				reading = false;
				if (active) setReadingState({ api, owner, reading: false });
			}
		};
		const refresh = () => void read();
		readNow.current = refresh;
		void read();
		const timer = setInterval(() => void read(), pollMs);
		return () => {
			active = false;
			mounted.current = false;
			if (readNow.current === refresh) readNow.current = null;
			clearInterval(timer);
		};
	}, [api, connection, workspaceId, owner, available, pollMs]);
	if (!available) return null;
	const snapshot =
		loaded?.api === api && loaded.owner === owner ? loaded : null;
	const refreshing =
		readingState?.api === api &&
		readingState.owner === owner &&
		readingState.reading;
	return (
		<section data-workspace-ports className="min-w-80 space-y-1 border-t pt-2">
			<div className="flex items-center justify-between gap-2 text-xs">
				<span>
					<Trans>Ports</Trans>
				</span>
				<Button
					type="button"
					variant="ghost"
					size="sm"
					disabled={refreshing}
					aria-busy={refreshing}
					onClick={() => readNow.current?.()}
				>
					<Trans>Refresh</Trans>
				</Button>
			</div>
			{closeError?.api === api && closeError.owner === owner && (
				<p role="alert" className="text-xs text-destructive">
					{closeError.message}
				</p>
			)}
			{snapshot?.error && (
				<p className="text-xs text-destructive" role="alert">
					{snapshot.error}
				</p>
			)}
			{!snapshot ? (
				<p className="text-xs text-muted-foreground">
					<Trans>Loading...</Trans>
				</p>
			) : snapshot.error ? null : snapshot.ports.length === 0 ? (
				<p className="text-xs text-muted-foreground">
					<Trans>No ports detected</Trans>
				</p>
			) : (
				<>
					<div className="max-h-64 overflow-y-auto">
						{snapshot.ports.map((port) => (
							<PortRowView
								key={`${port.terminalId}:${port.port}`}
								port={port}
								isPending={isClosing}
								closeDisabled={busy}
								onClose={
									typeof api.killWorkspacePort === "function"
										? () => void closePorts([port])
										: undefined
								}
								description={[port.label, port.processName]
									.filter(Boolean)
									.join(" · ")}
								externalDisabled={busy || !!snapshot.error}
								copyDisabled={busy}
								onCopy={
									onCopyPort && api.preparePort && api.copyText
										? async () => {
												if (
													!mounted.current ||
													current.current.api !== api ||
													current.current.owner !== owner ||
													!current.current.available ||
													current.current.busy
												)
													return;
												await current.current.onCopyPort?.(port.port);
											}
										: undefined
								}
								onPrimary={
									onOpenPortExternal
										? () => {
												if (
													!mounted.current ||
													current.current.api !== api ||
													current.current.owner !== owner ||
													!current.current.available ||
													current.current.busy ||
													snapshot.error
												)
													return;
												current.current.onOpenPort(port.port);
											}
										: undefined
								}
								onExternal={() => {
									if (
										!mounted.current ||
										current.current.api !== api ||
										current.current.owner !== owner ||
										!current.current.available ||
										current.current.busy ||
										snapshot.error
									)
										return;
									(
										current.current.onOpenPortExternal ??
										current.current.onOpenPort
									)(port.port);
								}}
							/>
						))}
					</div>
					{typeof api.killWorkspacePort === "function" && (
						<PortsFooterView
							totalPortCount={snapshot.ports.length}
							isPending={isClosing || busy}
							onCloseAll={() => void closePorts(snapshot.ports)}
						/>
					)}
				</>
			)}
		</section>
	);
}

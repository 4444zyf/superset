import type {
	DirectDescriptor,
	DirectWorkstationApi,
} from "../../../../shared/direct-workstation";
import { forwardedTerminalUrl, terminalUrlTarget } from "./terminal-url-target";

export async function openWorkspacePort({
	api,
	connection,
	workspaceId,
	port,
	targetUrl,
	isCurrent,
	existingForwardIds,
	openExternal,
}: {
	api: Pick<DirectWorkstationApi, "openPort" | "preparePort" | "closePort">;
	connection: DirectDescriptor;
	workspaceId: string;
	port: number;
	targetUrl?: string;
	isCurrent(): boolean;
	existingForwardIds?: ReadonlySet<string>;
	openExternal(url: string): Promise<void>;
}): Promise<{ id: string; url: string } | null> {
	if (!isCurrent()) return null;
	const prepare = api.preparePort?.bind(api);
	if (targetUrl !== undefined) {
		const target = terminalUrlTarget(targetUrl, false);
		if (!prepare || target?.kind !== "forward" || target.port !== port)
			return null;
	}
	const forward = await (prepare
		? prepare(connection, workspaceId, port)
		: api.openPort(connection, workspaceId, port));
	let retained = false;
	try {
		if (!isCurrent()) return null;
		const url =
			targetUrl === undefined
				? forward.url
				: forwardedTerminalUrl(targetUrl, forward.url);
		if (!url) return null;
		if (prepare) await openExternal(url);
		if (!isCurrent()) return null;
		retained = true;
		return { id: forward.id, url };
	} finally {
		if (!retained && !existingForwardIds?.has(forward.id))
			await api.closePort(forward.id);
	}
}

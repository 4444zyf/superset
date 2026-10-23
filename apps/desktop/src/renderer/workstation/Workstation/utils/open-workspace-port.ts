import type {
	DirectDescriptor,
	DirectWorkstationApi,
} from "../../../../shared/direct-workstation";

export async function openWorkspacePort({
	api,
	connection,
	workspaceId,
	port,
	isCurrent,
	openExternal,
}: {
	api: Pick<DirectWorkstationApi, "openPort" | "preparePort" | "closePort">;
	connection: DirectDescriptor;
	workspaceId: string;
	port: number;
	isCurrent(): boolean;
	openExternal(url: string): Promise<void>;
}): Promise<{ id: string; url: string } | null> {
	if (!isCurrent()) return null;
	const prepare = api.preparePort?.bind(api);
	const forward = await (prepare
		? prepare(connection, workspaceId, port)
		: api.openPort(connection, workspaceId, port));
	let retained = false;
	try {
		if (!isCurrent()) return null;
		if (prepare) await openExternal(forward.url);
		if (!isCurrent()) return null;
		retained = true;
		return forward;
	} finally {
		if (!retained) await api.closePort(forward.id);
	}
}

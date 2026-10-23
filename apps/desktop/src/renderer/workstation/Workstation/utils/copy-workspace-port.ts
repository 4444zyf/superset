import type {
	DirectDescriptor,
	DirectWorkstationApi,
} from "../../../../shared/direct-workstation";

export async function copyWorkspacePort({
	api,
	connection,
	workspaceId,
	port,
	isCurrent,
	existingForwardIds,
}: {
	api: Pick<DirectWorkstationApi, "preparePort" | "copyText" | "closePort">;
	connection: DirectDescriptor;
	workspaceId: string;
	port: number;
	isCurrent(): boolean;
	existingForwardIds?: ReadonlySet<string>;
}): Promise<{ id: string; url: string } | null> {
	if (!isCurrent() || !api.preparePort || !api.copyText) return null;
	const forward = await api.preparePort(connection, workspaceId, port);
	let retained = false;
	try {
		if (!isCurrent()) return null;
		await api.copyText(forward.url);
		if (!isCurrent()) return null;
		retained = true;
		return forward;
	} finally {
		if (!retained && !existingForwardIds?.has(forward.id))
			await api.closePort(forward.id);
	}
}

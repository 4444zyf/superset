import { useEffect, useState } from "react";
import type {
	DirectDescriptor,
	DirectWorkstationApi,
} from "../../../../../../../../../shared/direct-workstation";
import type { WorkstationFileDocuments } from "../../../../../WorkstationFileDocuments";
import { useWorkstationFileEvents } from "../../../../use-workstation-file-events";
export function WorkspaceDocumentEvents({
	api,
	connection,
	workspaceId,
	documents,
}: {
	api: DirectWorkstationApi;
	connection: DirectDescriptor;
	workspaceId: string;
	documents: WorkstationFileDocuments;
}) {
	const [root, setRoot] = useState("");
	useEffect(() => {
		if (connection.capabilities?.workstationFileEventsV1 !== true) return;
		let current = true;
		void api
			.rpc<{ worktreePath: string }>({
				connectionId: connection.connectionId,
				generation: connection.generation,
				path: "workspace.get",
				type: "query",
				input: { id: workspaceId },
			})
			.then(
				(workspace) => {
					if (current && typeof workspace.worktreePath === "string")
						setRoot(workspace.worktreePath);
				},
				() => {},
			);
		return () => {
			current = false;
		};
	}, [
		api,
		connection.connectionId,
		connection.generation,
		connection.capabilities?.workstationFileEventsV1,
		workspaceId,
	]);
	useWorkstationFileEvents({
		api,
		connection,
		workspaceId,
		root,
		paths: documents
			.getDocuments(connection, workspaceId)
			.map((document) => document.absolutePath),
		onEvents: (events) => {
			for (const event of events)
				documents.dispatchFsEvent(connection, workspaceId, event);
		},
		onRefresh: () => {},
	});
	return null;
}

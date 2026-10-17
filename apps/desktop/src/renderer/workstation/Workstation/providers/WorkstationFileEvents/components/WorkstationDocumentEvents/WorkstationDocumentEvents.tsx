import { useSyncExternalStore } from "react";
import type {
	DirectDescriptor,
	DirectWorkstationApi,
} from "../../../../../../../shared/direct-workstation";
import type { WorkstationFileDocuments } from "../../../WorkstationFileDocuments";
import { WorkspaceDocumentEvents } from "./components/WorkspaceDocumentEvents/WorkspaceDocumentEvents";
export function WorkstationDocumentEvents({
	api,
	connection,
	documents,
}: {
	api: DirectWorkstationApi;
	connection: DirectDescriptor;
	documents: WorkstationFileDocuments;
}) {
	useSyncExternalStore(
		documents.subscribe,
		documents.getVersion,
		documents.getVersion,
	);
	return documents
		.getDocumentWorkspaces(connection)
		.map((workspaceId) => (
			<WorkspaceDocumentEvents
				key={JSON.stringify([
					connection.connectionId,
					connection.backendId,
					connection.namespaceId,
					connection.generation,
					workspaceId,
				])}
				api={api}
				connection={connection}
				documents={documents}
				workspaceId={workspaceId}
			/>
		));
}

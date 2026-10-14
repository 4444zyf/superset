import { createContext, useContext, useMemo } from "react";
import type { DirectWorkstationApi } from "../../../../../shared/direct-workstation";
import { WorkstationFileDocuments } from "./workstation-file-documents";

export const WorkstationFileDocumentsContext =
	createContext<WorkstationFileDocuments | null>(null);
export function useWorkstationFileDocuments(api: DirectWorkstationApi) {
	const shared = useContext(WorkstationFileDocumentsContext);
	return useMemo(
		() => shared ?? new WorkstationFileDocuments(api),
		[shared, api],
	);
}

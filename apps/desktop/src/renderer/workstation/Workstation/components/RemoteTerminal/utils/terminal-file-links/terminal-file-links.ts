import { folderIntentForMap } from "renderer/lib/clickPolicy/policies/folderPolicy";
import type { TerminalLinkHandlers } from "renderer/lib/terminal/terminal-link-manager";
import { DEFAULT_V2_USER_PREFERENCES } from "renderer/routes/_authenticated/providers/CollectionsProvider/dashboardSidebarLocal/schema";
import type {
	DirectDescriptor,
	DirectWorkstationApi,
} from "../../../../../../../shared/direct-workstation";

export interface TerminalFileTarget {
	absolutePath: string;
	line?: number;
	column?: number;
	isDirectory?: boolean;
}

export function terminalFileLinks({
	api,
	connection,
	workspaceId,
	isCurrent,
	isReviewing,
	onOpenFile,
}: {
	api: DirectWorkstationApi;
	connection: DirectDescriptor;
	workspaceId: string;
	isCurrent(): boolean;
	isReviewing(): boolean;
	onOpenFile(target: TerminalFileTarget): void;
}): TerminalLinkHandlers {
	const available = () =>
		isCurrent() && connection.capabilities?.workstationFilesV1 === true;
	return {
		stat: async (path) => {
			if (!available()) return null;
			try {
				const result = await api.rpc<{
					resolvedPath: string;
					isDirectory: boolean;
				} | null>({
					connectionId: connection.connectionId,
					generation: connection.generation,
					path: "filesystem.statPath",
					type: "mutation",
					input: { workspaceId, path },
				});
				return available() && result ? result : null;
			} catch {
				return null;
			}
		},
		onFileLinkClick: (event, link) => {
			if (
				!available() ||
				isReviewing() ||
				event.button !== 0 ||
				(!event.metaKey && !event.ctrlKey)
			)
				return;
			if (
				link.isDirectory &&
				folderIntentForMap(event, DEFAULT_V2_USER_PREFERENCES.folderLinks) !==
					"reveal"
			)
				return;
			event.preventDefault();
			onOpenFile({
				absolutePath: link.resolvedPath,
				...(link.isDirectory ? { isDirectory: true } : {}),
				...(!link.isDirectory &&
				link.row &&
				Number.isSafeInteger(link.row) &&
				link.row > 0
					? { line: link.row }
					: {}),
				...(!link.isDirectory &&
				link.col &&
				Number.isSafeInteger(link.col) &&
				link.col > 0
					? { column: link.col }
					: {}),
			});
		},
	};
}

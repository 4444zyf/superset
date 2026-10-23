import type { TerminalLinkHandlers } from "renderer/lib/terminal/terminal-link-manager";
import type {
	DirectDescriptor,
	DirectWorkstationApi,
} from "../../../../../../../shared/direct-workstation";

export interface TerminalFileTarget {
	absolutePath: string;
	line?: number;
	column?: number;
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
				return available() && result && !result.isDirectory ? result : null;
			} catch {
				return null;
			}
		},
		onFileLinkClick: (event, link) => {
			if (
				!available() ||
				isReviewing() ||
				link.isDirectory ||
				event.button !== 0 ||
				(!event.metaKey && !event.ctrlKey)
			)
				return;
			event.preventDefault();
			onOpenFile({
				absolutePath: link.resolvedPath,
				...(link.row && Number.isSafeInteger(link.row) && link.row > 0
					? { line: link.row }
					: {}),
				...(link.col && Number.isSafeInteger(link.col) && link.col > 0
					? { column: link.col }
					: {}),
			});
		},
	};
}

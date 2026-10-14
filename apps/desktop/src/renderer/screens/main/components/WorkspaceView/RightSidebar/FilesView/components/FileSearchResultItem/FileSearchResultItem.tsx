import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuSeparator,
	ContextMenuTrigger,
} from "@superset/ui/context-menu";
import {
	LuClipboard,
	LuCopy,
	LuExternalLink,
	LuFile,
	LuFolder,
	LuFolderOpen,
	LuPencil,
	LuTrash2,
} from "react-icons/lu";
import type { DirectoryEntry } from "shared/file-tree-types";
import { useFileDrag, usePathActions } from "../../../ChangesView/hooks";
import { FileSearchResultRow } from "./components/FileSearchResultRow/FileSearchResultRow";

interface FileSearchResultItemProps {
	entry: DirectoryEntry;
	worktreePath: string;
	projectId?: string;
	onActivate: (entry: DirectoryEntry, openInNewTab?: boolean) => void;
	onOpenInEditor: (entry: DirectoryEntry) => void;
	onNewFile: (parentPath: string) => void;
	onNewFolder: (parentPath: string) => void;
	onRename: (entry: DirectoryEntry) => void;
	onDelete: (entry: DirectoryEntry) => void;
}

export function FileSearchResultItem({
	entry,
	worktreePath,
	projectId,
	onActivate,
	onOpenInEditor,
	onNewFile,
	onNewFolder,
	onRename,
	onDelete,
}: FileSearchResultItemProps) {
	const parentPath = entry.isDirectory
		? entry.path
		: entry.path.split("/").slice(0, -1).join("/") || worktreePath;

	const { copyPath, copyRelativePath, revealInFinder, openInEditor } =
		usePathActions({
			absolutePath: entry.path,
			relativePath: entry.relativePath,
			worktreePath,
			projectId,
		});

	const fileDragProps = useFileDrag({ absolutePath: entry.path });

	const handleClick = (e: React.MouseEvent) => {
		if (!entry.isDirectory) {
			if (e.shiftKey) {
				onActivate(entry, true);
			} else if (e.metaKey || e.ctrlKey) {
				onOpenInEditor(entry);
			} else {
				onActivate(entry);
			}
		}
	};

	const handleDoubleClick = () => {
		onOpenInEditor(entry);
	};

	const handleKeyDown = (e: React.KeyboardEvent) => {
		if (e.key === "Enter") {
			e.preventDefault();
			if (!entry.isDirectory) {
				onActivate(entry, e.metaKey || e.ctrlKey ? true : undefined);
			}
		}
	};

	const itemContent = (
		<FileSearchResultRow
			entry={entry}
			{...fileDragProps}
			onClick={handleClick}
			onDoubleClick={handleDoubleClick}
			onKeyDown={handleKeyDown}
		/>
	);

	return (
		<ContextMenu>
			<ContextMenuTrigger asChild>{itemContent}</ContextMenuTrigger>
			<ContextMenuContent className="w-48">
				<ContextMenuItem onClick={() => onNewFile(parentPath)}>
					<LuFile className="mr-2 size-4" />
					New File
				</ContextMenuItem>
				<ContextMenuItem onClick={() => onNewFolder(parentPath)}>
					<LuFolder className="mr-2 size-4" />
					New Folder
				</ContextMenuItem>

				<ContextMenuSeparator />

				<ContextMenuItem onClick={copyPath}>
					<LuClipboard className="mr-2 size-4" />
					Copy Path
				</ContextMenuItem>
				<ContextMenuItem onClick={copyRelativePath}>
					<LuCopy className="mr-2 size-4" />
					Copy Relative Path
				</ContextMenuItem>

				<ContextMenuSeparator />

				<ContextMenuItem onClick={revealInFinder}>
					<LuFolderOpen className="mr-2 size-4" />
					Reveal in Finder
				</ContextMenuItem>
				<ContextMenuItem onClick={openInEditor}>
					<LuExternalLink className="mr-2 size-4" />
					Open in Editor
				</ContextMenuItem>

				<ContextMenuSeparator />

				<ContextMenuItem onClick={() => onRename(entry)}>
					<LuPencil className="mr-2 size-4" />
					Rename
				</ContextMenuItem>
				<ContextMenuItem
					onClick={() => onDelete(entry)}
					className="text-destructive focus:text-destructive"
				>
					<LuTrash2 className="mr-2 size-4" />
					Delete
				</ContextMenuItem>
			</ContextMenuContent>
		</ContextMenu>
	);
}

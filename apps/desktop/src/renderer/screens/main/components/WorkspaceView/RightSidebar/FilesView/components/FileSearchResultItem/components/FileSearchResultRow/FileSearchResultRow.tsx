import { cn } from "@superset/ui/utils";
import type { ComponentPropsWithRef } from "react";
import type { DirectoryEntry } from "shared/file-tree-types";
import { SEARCH_RESULT_ROW_HEIGHT } from "../../../../constants";
import { FileIcon } from "../../../../utils";

const PATH_LABEL_MAX_CHARS = 48;

function folderLabel(relativePath: string): string {
	const normalized = relativePath.replace(/\\/g, "/");
	const index = normalized.lastIndexOf("/");
	const label = index <= 0 ? "root" : normalized.slice(0, index);
	return label.length > PATH_LABEL_MAX_CHARS
		? `...${label.slice(-(PATH_LABEL_MAX_CHARS - 3))}`
		: label;
}

export function FileSearchResultRow({
	entry,
	className,
	style,
	...props
}: ComponentPropsWithRef<"div"> & { entry: DirectoryEntry }) {
	return (
		<div
			role="treeitem"
			tabIndex={0}
			{...props}
			style={{ height: SEARCH_RESULT_ROW_HEIGHT, ...style }}
			className={cn(
				"flex items-center gap-1 px-1 cursor-pointer select-none hover:bg-accent/50 transition-colors",
				className,
			)}
		>
			<span className="flex items-center justify-center w-4 h-4 shrink-0" />
			<div className="flex flex-col min-w-0 flex-1 gap-0.5">
				<span
					className="text-[10px] text-muted-foreground truncate"
					title={entry.relativePath}
				>
					{folderLabel(entry.relativePath)}
				</span>
				<div className="flex items-center gap-1 min-w-0">
					<FileIcon
						fileName={entry.name}
						isDirectory={entry.isDirectory}
						className="size-4 shrink-0"
					/>
					<span className="flex-1 min-w-0 text-xs truncate">{entry.name}</span>
				</div>
			</div>
		</div>
	);
}

import type { FileTree } from "@pierre/trees";
import { asDirectoryHandle } from "../treePath";
export function collapseFileTreeDirectories(
	model: FileTree,
	paths: Iterable<string>,
): void {
	for (const path of paths) {
		if (!path.endsWith("/")) continue;
		const handle = asDirectoryHandle(model.getItem(path));
		if (handle?.isExpanded()) handle.collapse();
	}
}

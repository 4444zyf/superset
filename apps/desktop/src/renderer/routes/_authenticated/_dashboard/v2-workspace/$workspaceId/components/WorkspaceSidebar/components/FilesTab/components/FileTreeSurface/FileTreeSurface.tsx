import { FileTree, type FileTreeProps } from "@pierre/trees/react";
import { createPierreTreeStyle } from "renderer/lib/pierreTree";
import {
	FILE_EXPLORER_INDENT,
	FILE_EXPLORER_ROW_HEIGHT,
} from "../../constants";

const TREE_STYLE = createPierreTreeStyle({
	rowHeight: FILE_EXPLORER_ROW_HEIGHT,
	levelIndent: FILE_EXPLORER_INDENT,
	withSearchChrome: true,
});

export function FileTreeSurface(props: FileTreeProps) {
	return <FileTree {...props} style={{ ...TREE_STYLE, ...props.style }} />;
}

import { codeViewLabel } from "../../viewLabels";
import type { FileView } from "../../types";
import { CodeView } from "./CodeView";

export const codeView: FileView = {
	id: "code",
	label: codeViewLabel,
	match: (_, meta) => meta.isBinary !== true,
	priority: "builtin",
	documentKind: "text",
	Renderer: CodeView,
};

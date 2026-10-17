import type { NodeViewProps } from "@tiptap/react";
import { NodeViewWrapper } from "@tiptap/react";
import { CodeBlockSurface } from "renderer/components/MarkdownRenderer/components/CodeBlockSurface";
import { useContext } from "react";
import { MarkdownAppearanceContext } from "../../MarkdownAppearanceContext";

export function ReadOnlyCodeBlockView({ node }: NodeViewProps) {
 const isDark=useContext(MarkdownAppearanceContext);
	const language =
		typeof node.attrs.language === "string" ? node.attrs.language : undefined;

	return (
		<NodeViewWrapper as="div" className="my-4">
			<CodeBlockSurface isDark={isDark} className={`language-${language || "text"}`}>
				{node.textContent}
			</CodeBlockSurface>
		</NodeViewWrapper>
	);
}

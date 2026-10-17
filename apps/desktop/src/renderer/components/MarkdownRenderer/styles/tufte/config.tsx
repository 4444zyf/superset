import { CodeBlock, SafeImage } from "../../components";
import type { MarkdownStyleConfig } from "../types";
import { tuftePresentation } from "./presentation";

export const tufteConfig: MarkdownStyleConfig = {
	...tuftePresentation,
	components: {
		// Minimal overrides - let CSS handle styling
		code: ({ className, children, node }) => (
			<CodeBlock className={className} node={node}>
				{children}
			</CodeBlock>
		),
		img: ({ src, alt }) => <SafeImage src={src} alt={alt} />,
	},
};

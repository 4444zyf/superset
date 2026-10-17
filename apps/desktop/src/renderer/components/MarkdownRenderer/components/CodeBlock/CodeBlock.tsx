import { useTheme } from "renderer/stores";
import {
	CodeBlockSurface,
	type CodeBlockSurfaceProps,
} from "../CodeBlockSurface";
export function CodeBlock(props: Omit<CodeBlockSurfaceProps, "isDark">) {
	const theme = useTheme();
	return <CodeBlockSurface {...props} isDark={theme?.type !== "light"} />;
}

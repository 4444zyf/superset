import { MultiFileDiff } from "@pierre/diffs/react";
import { cn } from "@superset/ui/utils";
import type { CSSProperties } from "react";
import {
	getDiffsTheme,
	getDiffViewerStyle,
} from "renderer/screens/main/components/WorkspaceView/utils/code-theme";
import type { DiffViewMode, FileContents } from "shared/changes-types";
import type { Theme } from "shared/themes";
export interface LightDiffSurfaceProps {
	contents: FileContents;
	viewMode: DiffViewMode;
	hideUnchangedRegions?: boolean;
	filePath: string;
	className?: string;
	style?: CSSProperties;
	theme: Theme;
	fontSettings?: {
		editorFontFamily?: string | null;
		editorFontSize?: number | string | null;
	};
}
export function LightDiffSurface({
	contents,
	viewMode,
	hideUnchangedRegions,
	filePath,
	className,
	style,
	theme,
	fontSettings,
}: LightDiffSurfaceProps) {
	const shikiTheme = getDiffsTheme(theme);
	const parsedEditorFontSize =
		typeof fontSettings?.editorFontSize === "number"
			? fontSettings.editorFontSize
			: typeof fontSettings?.editorFontSize === "string"
				? Number.parseFloat(fontSettings.editorFontSize)
				: Number.NaN;
	const diffStyle = getDiffViewerStyle(theme, {
		fontFamily: fontSettings?.editorFontFamily ?? undefined,
		fontSize: Number.isFinite(parsedEditorFontSize)
			? parsedEditorFontSize
			: undefined,
	});

	return (
		<MultiFileDiff
			oldFile={{ name: filePath, contents: contents.original }}
			newFile={{ name: filePath, contents: contents.modified }}
			className={cn(className)}
			style={{
				...diffStyle,
				...style,
			}}
			options={{
				diffStyle: viewMode === "side-by-side" ? "split" : "unified",
				expandUnchanged: !hideUnchangedRegions,
				theme: shikiTheme,
				themeType: theme.type,
				overflow: "wrap",
				disableFileHeader: true,
				unsafeCSS: `
					* {
						user-select: text;
						-webkit-user-select: text;
					}
				`,
			}}
		/>
	);
}

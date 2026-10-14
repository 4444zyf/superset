import type { CSSProperties } from "react";
import { electronTrpc } from "renderer/lib/electron-trpc";
import { useResolvedTheme } from "renderer/stores/theme";
import type { DiffViewMode, FileContents } from "shared/changes-types";

import { LightDiffSurface } from "./components/LightDiffSurface/LightDiffSurface";

interface LightDiffViewerProps {
	contents: FileContents;
	viewMode: DiffViewMode;
	hideUnchangedRegions?: boolean;
	filePath: string;
	className?: string;
	style?: CSSProperties;
}

export function LightDiffViewer({
	contents,
	viewMode,
	hideUnchangedRegions,
	filePath,
	className,
	style,
}: LightDiffViewerProps) {
	const activeTheme = useResolvedTheme();
	const { data: fontSettings } = electronTrpc.settings.getFontSettings.useQuery(
		undefined,
		{
			staleTime: 30_000,
		},
	);
	return (
		<LightDiffSurface
			contents={contents}
			viewMode={viewMode}
			hideUnchangedRegions={hideUnchangedRegions}
			filePath={filePath}
			className={className}
			style={style}
			theme={activeTheme}
			fontSettings={fontSettings}
		/>
	);
}

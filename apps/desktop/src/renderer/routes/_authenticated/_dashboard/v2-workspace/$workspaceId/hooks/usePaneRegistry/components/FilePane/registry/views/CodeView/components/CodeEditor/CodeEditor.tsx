import { useQuery } from "@tanstack/react-query";
import { FONT_SETTINGS_QUERY_KEY } from "renderer/lib/font-settings";
import { electronTrpcClient } from "renderer/lib/trpc-client";
import { useResolvedTheme } from "renderer/stores/theme";
import {
	CodeEditorSurface,
	type CodeEditorSurfaceProps,
} from "./CodeEditorSurface";

export function CodeEditor(
	props: Omit<CodeEditorSurfaceProps, "theme" | "fontSettings">,
) {
	const { data: fontSettings } = useQuery({
		queryKey: FONT_SETTINGS_QUERY_KEY,
		queryFn: () => electronTrpcClient.settings.getFontSettings.query(),
		staleTime: 30_000,
	});
	const theme = useResolvedTheme();
	return (
		<CodeEditorSurface {...props} theme={theme} fontSettings={fontSettings} />
	);
}

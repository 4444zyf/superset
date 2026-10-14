import type { ComponentProps } from "react";
import { useTheme } from "renderer/stores";
import { FontPreviewSurface } from "./components/FontPreviewSurface";

export function FontPreview(
	props: Omit<ComponentProps<typeof FontPreviewSurface>, "theme">,
) {
	return <FontPreviewSurface {...props} theme={useTheme()} />;
}

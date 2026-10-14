import { useTheme } from "renderer/stores";
import {
	type TypographySurfaceCardProps,
	TypographySurfaceCardView,
} from "./components/TypographySurfaceCardView";

export type { FontSettingsUpdate } from "./components/TypographySurfaceCardView/TypographySurfaceCardView";

export function TypographySurfaceCard(props: TypographySurfaceCardProps) {
	return <TypographySurfaceCardView {...props} theme={useTheme()} />;
}

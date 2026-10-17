import { useIsDarkTheme } from "renderer/assets/app-icons/preset-icons";
import { AgentIconView } from "./components/AgentIconView/AgentIconView";

interface AgentIconProps {
	/**
	 * Explicit icon override: a built-in icon key or an uploaded `data:` image
	 * URI. Falls back to the icon implied by `presetId`.
	 */
	iconId?: string | null;
	presetId: string;
	/** Sizing/color classes applied to both the image and the fallback glyph. */
	className?: string;
}

export function AgentIcon({ iconId, presetId, className }: AgentIconProps) {
	return (
		<AgentIconView
			iconId={iconId}
			presetId={presetId}
			className={className}
			isDark={useIsDarkTheme()}
		/>
	);
}

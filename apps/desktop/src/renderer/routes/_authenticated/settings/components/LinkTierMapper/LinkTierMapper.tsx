import { FEATURE_FLAGS } from "@superset/shared/constants";
import { useFeatureFlagEnabled } from "posthog-js/react";
import { useSettingsSearchQuery } from "renderer/stores/settings-state";
import {
	LinkTierMapperView,
	type LinkTierMapperProps,
} from "./components/LinkTierMapperView";
export type { LinkTierMapperProps } from "./components/LinkTierMapperView";
export function LinkTierMapper(props: LinkTierMapperProps) {
	const searchQuery = useSettingsSearchQuery();
	const isRightPaneAreaEnabled =
		useFeatureFlagEnabled(FEATURE_FLAGS.RIGHT_PANE_AREA) === true;
	return (
		<LinkTierMapperView
			{...props}
			searchQuery={searchQuery}
			isRightPaneAreaEnabled={isRightPaneAreaEnabled}
		/>
	);
}

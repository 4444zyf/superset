import { useLingui } from "@lingui/react/macro";
import { toast } from "@superset/ui/sonner";
import { useCallback } from "react";
import { useV2UserPreferences } from "renderer/hooks/useV2UserPreferences";
import { type LinkAction, type LinkTierMap } from "renderer/lib/clickPolicy";
import { useSettingsSearchQuery } from "renderer/stores/settings-state";
import { FEATURE_FLAGS } from "@superset/shared/constants";
import { useFeatureFlagEnabled } from "posthog-js/react";
import { BrowserLinkSettingsView } from "./components/BrowserLinkSettingsView";
import {
	isItemVisible,
	SETTING_ITEM_ID,
	type SettingItemId,
} from "../../../../../utils/settings-search";

interface BrowserLinkSettingsProps {
	visibleItems?: SettingItemId[] | null;
}

export function BrowserLinkSettings({
	visibleItems,
}: BrowserLinkSettingsProps) {
	const { t } = useLingui();
	const searchQuery = useSettingsSearchQuery();
	const isRightPaneAreaEnabled =
		useFeatureFlagEnabled(FEATURE_FLAGS.RIGHT_PANE_AREA) === true;
	const { preferences, setUrlLinks, setPortOpenAction } =
		useV2UserPreferences();
	const showUrl = isItemVisible(SETTING_ITEM_ID.LINKS_URL, visibleItems);
	const showPort = isItemVisible(SETTING_ITEM_ID.LINKS_PORT, visibleItems);

	const handleUrlChange = useCallback(
		(next: LinkTierMap) => {
			setUrlLinks(next);
			toast.success(t({ message: "Changes saved" }));
		},
		[setUrlLinks, t],
	);

	const handlePortChange = useCallback(
		(next: LinkAction) => {
			setPortOpenAction(next);
			toast.success(t({ message: "Changes saved" }));
		},
		[setPortOpenAction, t],
	);

	return (
		<BrowserLinkSettingsView
			urlLinks={preferences.urlLinks}
			portOpenAction={preferences.portOpenAction}
			onUrlLinks={handleUrlChange}
			onPortOpenAction={handlePortChange}
			showUrl={showUrl}
			showPort={showPort}
			searchQuery={searchQuery}
			isRightPaneAreaEnabled={isRightPaneAreaEnabled}
		/>
	);
}

import { useCallback, useMemo } from "react";
import { useV2UserPreferences } from "renderer/hooks/useV2UserPreferences";
import { buildHint } from "../hint";
import { tierFor } from "../tiers";
import type {
	LinkAction,
	ModifierEvent,
	ResolvedClick,
	Surface,
	TierMode,
} from "../types";
import type { ClickPolicy } from "./buildPolicy";
import { tierForActionIn } from "./buildPolicy";

export { buildPolicy, type ClickPolicy } from "./buildPolicy";

type MapKey = "fileLinks" | "urlLinks" | "sidebarFileLinks" | "pageLinks";

export function usePolicy(
	key: MapKey,
	surface: Surface,
	mode: TierMode,
): ClickPolicy {
	const { preferences } = useV2UserPreferences();
	const map = preferences[key];
	const resolve = useCallback(
		(event: ModifierEvent): ResolvedClick => {
			const tier = tierFor(event, mode);
			return { tier, action: map[tier] };
		},
		[map, mode],
	);
	const getAction = useCallback(
		(event: ModifierEvent) => resolve(event).action,
		[resolve],
	);
	const tierForAction = useCallback(
		(action: LinkAction) => tierForActionIn(map, action),
		[map],
	);
	const hint = useMemo(
		() => buildHint(map, surface, mode),
		[map, surface, mode],
	);
	return { resolve, getAction, tierForAction, hint, map };
}

import { Trans } from "@lingui/react/macro";
import { lazy, Suspense, useState } from "react";
import { DiffFileHeaderName } from "renderer/screens/main/components/DiffFileHeaderName";
import { DiffViewToolbar } from "renderer/screens/main/components/DiffViewToolbar";
import { UnchangedRegionsButton } from "renderer/screens/main/components/WorkspaceView/ChangesContent/components/InfiniteScrollView/components/DiffToolbar/components/UnchangedRegionsButton/UnchangedRegionsButton";
import { useSettings } from "renderer/stores/settings";
import { detectLanguage } from "shared/detect-language";
import { useWorkstationAppearance } from "../../../../providers/WorkstationPreferencesContext";

const LightDiffSurface = lazy(() =>
	import(
		"renderer/screens/main/components/WorkspaceView/ChangesContent/components/LightDiffViewer/components/LightDiffSurface/LightDiffSurface"
	).then((module) => ({ default: module.LightDiffSurface })),
);

export function RemoteGitDiff({
	path,
	original,
	modified,
}: {
	path: string;
	original: string;
	modified: string;
}) {
	const appearance = useWorkstationAppearance();
	const diffStyle = useSettings((state) => state.diffStyle);
	const expandUnchanged = useSettings((state) => state.expandUnchanged);
	const [collapsed, setCollapsed] = useState(false);
	return (
		<section
			className="min-w-0 border border-border rounded-md overflow-hidden"
			data-remote-git-diff={path}
		>
			<DiffViewToolbar
				areAllFilesCollapsed={collapsed}
				onToggleCollapseAll={() => setCollapsed((value) => !value)}
			>
				<DiffFileHeaderName path={path} />
				<UnchangedRegionsButton
					hideUnchangedRegions={!expandUnchanged}
					onToggle={() =>
						useSettings.getState().update("expandUnchanged", !expandUnchanged)
					}
				/>
			</DiffViewToolbar>
			<div hidden={collapsed} className="max-h-[65vh] overflow-auto">
				<Suspense
					fallback={
						<p>
							<Trans>Loading files...</Trans>
						</p>
					}
				>
					<LightDiffSurface
						contents={{ original, modified, language: detectLanguage(path) }}
						viewMode={diffStyle === "split" ? "side-by-side" : "inline"}
						hideUnchangedRegions={!expandUnchanged}
						filePath={path}
						theme={appearance.theme}
						fontSettings={appearance.fontSettings}
					/>
				</Suspense>
			</div>
		</section>
	);
}

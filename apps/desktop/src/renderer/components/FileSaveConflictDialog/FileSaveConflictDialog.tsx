import { LightDiffViewer } from "renderer/screens/main/components/WorkspaceView/ChangesContent/components/LightDiffViewer";
import {
	FileSaveConflictDialogSurface,
	type FileSaveConflictDialogSurfaceProps,
} from "./components/FileSaveConflictDialogSurface";

type FileSaveConflictDialogProps = Omit<
	FileSaveConflictDialogSurfaceProps,
	"renderDiff"
>;
export function FileSaveConflictDialog(props: FileSaveConflictDialogProps) {
	return (
		<FileSaveConflictDialogSurface
			{...props}
			renderDiff={(contents, filePath) => (
				<LightDiffViewer
					contents={contents}
					viewMode="side-by-side"
					hideUnchangedRegions={false}
					filePath={filePath}
				/>
			)}
		/>
	);
}

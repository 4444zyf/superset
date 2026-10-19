import {
	isAbsoluteFilesystemPath,
	toRelativeWorkspacePath,
} from "shared/absolute-paths";
export function toPresetDirectoryValue(
	workspacePath: string,
	selectedPath: string,
): string {
	const relativePath = toRelativeWorkspacePath(workspacePath, selectedPath);
	if (isAbsoluteFilesystemPath(relativePath)) {
		return selectedPath;
	}
	return relativePath === "." ? "." : `./${relativePath}`;
}

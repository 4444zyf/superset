import { CLIError } from "@superset/cli-framework";
import { normalizeWorkspaceTag } from "@superset/shared/workspace-tags";
import type { HostWorkspaceRow } from "../../../lib/host-workspaces/workspacesOnHost";

export function filterListedWorkspaces(
	workspaces: HostWorkspaceRow[],
	options: { project?: string; search?: string; tag?: string },
) {
	const projectInput = options.project?.toLowerCase();
	const search = options.search?.toLowerCase();
	// Normalize both sides — `--tag Perf` must match a workspace tagged
	// "perf". Rows served by an older host carry no tags field.
	const tagFilter = normalizeWorkspaceTag(options.tag);
	if (options.tag !== undefined && tagFilter == null) {
		throw new CLIError(
			"Invalid --tag value",
			"Tags are 1-64 characters after trimming",
		);
	}
	return workspaces
		.filter(
			(workspace) =>
				!projectInput ||
				workspace.projectId?.toLowerCase() === projectInput ||
				workspace.projectName?.toLowerCase() === projectInput,
		)
		.filter(
			(workspace) =>
				!search ||
				workspace.name.toLowerCase().includes(search) ||
				workspace.branch.toLowerCase().includes(search),
		)
		.filter(
			(workspace) =>
				tagFilter == null || (workspace.tags ?? []).includes(tagFilter),
		)
		.map((workspace) => ({
			...workspace,
			// Orphaned projectIds fall back to the raw id; project-less
			// session workspaces render as "session".
			projectName: workspace.projectName ?? workspace.projectId ?? "session",
			tags: (workspace.tags ?? []).join(", "),
		}));
}

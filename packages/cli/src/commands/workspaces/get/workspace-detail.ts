import { CLIError } from "@superset/cli-framework";
import type { HostWorkspaceRow } from "../../../lib/host-workspaces/workspacesOnHost";

export function describeHostWorkspace(
	workspace: HostWorkspaceRow,
	hostName: string,
) {
	return {
		id: workspace.id,
		name: workspace.name,
		branch: workspace.branch,
		type: workspace.type,
		projectId: workspace.projectId,
		projectName: workspace.projectName ?? workspace.projectId,
		hostId: workspace.hostId,
		hostName,
		taskId: workspace.taskId,
		worktreePath: workspace.worktreePath,
		worktreeExists: workspace.worktreeExists,
		createdAt: workspace.createdAt,
	};
}

export function formatWorkspaceDetail(
	detail: Record<string, unknown>,
	field?: string,
) {
	if (field) {
		if (!Object.hasOwn(detail, field)) {
			throw new CLIError(
				`Unknown field: ${field}`,
				`Available fields: ${Object.keys(detail).join(", ")}`,
			);
		}
		const value = detail[field];
		return {
			data: detail,
			message: value === null || value === undefined ? "" : String(value),
		};
	}

	const width = Math.max(...Object.keys(detail).map((key) => key.length));
	const message = Object.entries(detail)
		.map(([key, value]) => {
			const shown = value === null || value === undefined ? "—" : value;
			return `${key.padEnd(width)}  ${shown}`;
		})
		.join("\n");
	return { data: detail, message };
}

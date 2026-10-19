import { boolean, CLIError, string, table } from "@superset/cli-framework";
import { resolveWorkspaceHost } from "../../../lib/cloud-workspaces";
import { command } from "../../../lib/command";
import {
	namespaceOption,
	readFromDirectNamespace,
} from "../../../lib/direct-namespace";
import { listWorkspacesOnHost } from "../../../lib/host-workspaces";
import { filterListedWorkspaces } from "./filter-workspaces";

export default command({
	description:
		"List workspaces: cloud workspaces by default if your account has them, else this machine's; --local or --host picks a host",
	options: {
		namespace: namespaceOption(),
		host: string().desc("List workspaces on this host (machineId)"),
		local: boolean().desc("List workspaces on this machine"),
		project: string().desc("Filter by project name (case-insensitive) or id"),
		search: string()
			.alias("s")
			.desc("Search by workspace name or branch substring"),
		tag: string().desc("Filter to workspaces carrying this tag"),
	},
	// `display` gets the data alone, and the two listings are different rows;
	// `status` is the cloud-only column, so it tells them apart.
	display: (data) => {
		const rows = data as Record<string, unknown>[];
		if (rows.some((row) => row.status !== undefined)) {
			return table(
				rows,
				["name", "branch", "status", "id"],
				["NAME", "BRANCH", "STATUS", "ID"],
				[30, 30, 14, 36],
			);
		}
		return table(
			rows,
			["name", "branch", "projectName", "tags", "id"],
			["NAME", "BRANCH", "PROJECT", "TAGS", "ID"],
			[30, 30, 24, 20, 36],
		);
	},
	run: async ({ ctx, options }) => {
		const direct = await readFromDirectNamespace(options, (target) =>
			target.client.workspace.list.query(),
		);
		if (direct) return filterListedWorkspaces(direct.value, options);
		const organizationId = ctx.config.organizationId;
		if (!organizationId) {
			throw new CLIError("No active organization", "Run: superset auth login");
		}

		const hostId = await resolveWorkspaceHost(
			{ host: options.host, local: options.local },
			ctx.api,
			organizationId,
		);
		if (!hostId) {
			for (const [flag, value] of [
				["--project", options.project],
				["--tag", options.tag],
			] as const) {
				if (value !== undefined) {
					throw new CLIError(
						`${flag} does not apply to cloud workspaces`,
						"Pass --local to list this machine's workspaces, or --host <id> for another host",
					);
				}
			}
			const cloudWorkspaces = await ctx.api.cloudWorkspace.list.query({
				organizationId,
			});
			const search = options.search?.toLowerCase();
			return cloudWorkspaces.filter(
				(workspace) =>
					!search ||
					workspace.name.toLowerCase().includes(search) ||
					workspace.branch.toLowerCase().includes(search),
			);
		}

		const { workspaces } = await listWorkspacesOnHost({
			organizationId,
			userJwt: ctx.bearer,
			api: ctx.api,
			hostId,
		});

		return filterListedWorkspaces(workspaces, options);
	},
});

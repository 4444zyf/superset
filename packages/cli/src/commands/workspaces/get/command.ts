import { msg } from "@lingui/core/macro";
import { boolean, CLIError, positional, string } from "@superset/cli-framework";
import { i18n } from "@superset/i18n";
import { resolveWorkspaceHost } from "../../../lib/cloud-workspaces";
import { command } from "../../../lib/command";
import {
	namespaceOption,
	readFromDirectNamespace,
} from "../../../lib/direct-namespace";
import { resolveWorkspaceTarget } from "../../../lib/host-workspaces";
import {
	describeHostWorkspace,
	formatWorkspaceDetail,
} from "./workspace-detail";

export default command({
	description: "Show details for a single workspace by id",
	args: [
		positional("id").desc("Workspace ID (defaults to $SUPERSET_WORKSPACE_ID)"),
	],
	options: {
		namespace: namespaceOption(),
		host: string().desc(
			"Host the workspace lives on (default: the cloud if your account has cloud workspaces, else this machine)",
		),
		local: boolean().desc("The workspace is on this machine"),
		field: string()
			.alias("f")
			.desc(
				"Print a single field's raw value (e.g. name, branch, worktreePath)",
			),
	},
	run: async ({ ctx, args, options }) => {
		const id =
			(args.id as string | undefined) ?? process.env.SUPERSET_WORKSPACE_ID;
		if (!id) {
			throw new CLIError(
				"No workspace id",
				"Pass an id or run inside a workspace where $SUPERSET_WORKSPACE_ID is set",
			);
		}

		const direct = await readFromDirectNamespace(options, async (target) => {
			const workspaces = await target.client.workspace.list.query();
			const workspace = workspaces.find((row) => row.id === id);
			if (!workspace)
				throw new CLIError(i18n._(msg({ message: "Workspace not found" })), id);
			return describeHostWorkspace(workspace, workspace.hostId);
		});
		if (direct) return formatWorkspaceDetail(direct.value, options.field);

		const organizationId = ctx.config.organizationId;
		if (!organizationId) {
			throw new CLIError("No active organization", "Run: superset auth login");
		}

		const hostId = await resolveWorkspaceHost(
			{ host: options.host, local: options.local },
			ctx.api,
			organizationId,
		);
		const detail = hostId
			? await hostDetail(ctx, organizationId, id, hostId)
			: await cloudDetail(ctx, organizationId, id);

		return formatWorkspaceDetail(detail, options.field);
	},
});

type Ctx = Parameters<Parameters<typeof command>[0]["run"]>[0]["ctx"];

/** A cloud workspace's details are the API's row; reading them never wakes its sandbox. */
async function cloudDetail(ctx: Ctx, organizationId: string, id: string) {
	const rows = await ctx.api.cloudWorkspace.list.query({ organizationId });
	const row = rows.find((candidate) => candidate.id === id);
	if (!row) {
		throw new CLIError(
			`No cloud workspace ${id} in this organization`,
			"Pass --local for a workspace on this machine, or --host <id> for another host",
		);
	}
	return {
		id: row.id,
		name: row.name,
		branch: row.branch,
		status: row.status,
		environmentId: row.environmentId,
		createdByUserId: row.createdByUserId,
		createdAt: row.createdAt,
	};
}

/** The row carries its host-served project name; the host id is enriched with its cloud name for display only. */
async function hostDetail(
	ctx: Ctx,
	organizationId: string,
	id: string,
	hostId: string,
) {
	const [{ workspace }, hosts] = await Promise.all([
		resolveWorkspaceTarget(
			{
				organizationId,
				userJwt: ctx.bearer,
				api: ctx.api,
				host: hostId,
			},
			id,
		),
		ctx.api.host.list
			.query({ organizationId })
			.catch(() => [] as Array<{ id: string; name: string }>),
	]);
	return describeHostWorkspace(
		workspace,
		hosts.find((host) => host.id === workspace.hostId)?.name ??
			workspace.hostId,
	);
}

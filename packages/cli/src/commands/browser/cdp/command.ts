import { CLIError, string } from "@superset/cli-framework";
import { command } from "../../../lib/command";
import { namespaceOption } from "../../../lib/direct-namespace";
import { cdpDirectNamespace } from "../../../lib/direct-namespace/browser-cdp";
import { resolveBrowserTarget } from "../shared";

export default command({
	description:
		"Print a raw CDP WebSocket endpoint for a pane (for browser-use / Playwright-class tools)",
	options: {
		namespace: namespaceOption(),
		workspace: string().required().desc("Workspace ID"),
		host: string().desc("Host the workspace lives on (default: this machine)"),
		pane: string().required().desc("Pane ID (from `superset browser list`)"),
	},
	run: async ({ ctx, options }) => {
		const direct = await cdpDirectNamespace(options);
		const { client, ws } = direct ?? (await resolveBrowserTarget(ctx, options));
		// Verify the pane exists in this workspace before handing out a URL — a
		// dead/foreign pane id would otherwise fail only once the tool dials in.
		const { panes } = await client.browser.list.query({
			workspaceId: options.workspace,
		});
		if (!panes.some((p) => p.paneId === options.pane)) {
			throw new CLIError(
				`No browser pane ${options.pane} in workspace ${options.workspace}`,
				"Run: superset browser list --workspace <id>",
			);
		}
		const url = direct
			? `${ws.baseWsUrl}/browser/${encodeURIComponent(options.pane)}/cdp-v1?workspaceId=${encodeURIComponent(options.workspace)}&instanceId=${encodeURIComponent(direct.ws.instanceId)}&token=${encodeURIComponent(ws.token)}`
			: `${ws.baseWsUrl}/browser/${encodeURIComponent(
					options.pane,
				)}/cdp?workspaceId=${encodeURIComponent(options.workspace)}&token=${encodeURIComponent(ws.token)}`;
		return {
			data: { url },
			// The URL embeds a bearer token — treat it as a credential (keep it out
			// of shared logs / screenshots).
			message: `${url}\n\nNote: this URL contains an auth token — treat it as a secret.`,
		};
	},
});

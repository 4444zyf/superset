import { browserBridgeListResultSchema } from "@superset/shared/browser-bridge";
import { string } from "@superset/cli-framework";
import { command } from "../../../lib/command";
import {
	namespaceOption,
	readFromDirectNamespace,
} from "../../../lib/direct-namespace";
import { resolveBrowserTarget } from "../shared";

export default command({
	description: "List the browser panes open in a workspace",
	options: {
		namespace: namespaceOption(),
		workspace: string().required().desc("Workspace ID"),
		host: string().desc("Host the workspace lives on (default: this machine)"),
	},
	run: async ({ ctx, options }) => {
		const direct = await readFromDirectNamespace(options, (target) =>
			target.client.direct.browserReadV1.query({
				type: "list",
				workspaceId: options.workspace,
			}),
		);
		const client = direct
			? null
			: (await resolveBrowserTarget(ctx, options)).client;
		const { panes } = direct
			? browserBridgeListResultSchema.parse(direct.value)
			: await client!.browser.list.query({
					workspaceId: options.workspace,
				});
		return {
			data: panes,
			message: panes.length
				? panes.map((p) => `${p.paneId}\t${p.url}\t${p.title}`).join("\n")
				: "No browser panes open in this workspace.",
		};
	},
});

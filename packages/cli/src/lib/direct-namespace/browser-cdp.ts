import { CLIError } from "@superset/cli-framework";
import { browserBridgeListResultSchema } from "@superset/shared/browser-bridge";
import { resolveBrowserCdpNamespace } from "./resolveDirectNamespace";

export async function cdpDirectNamespace(options: {
	namespace?: string;
	host?: string;
	workspace: string;
	pane: string;
}) {
	if (options.namespace === undefined) return null;
	if (options.host !== undefined)
		throw new CLIError("Pass either --namespace or --host, not both");
	const target = await resolveBrowserCdpNamespace(options.namespace, {
		workspaceId: options.workspace,
		paneId: options.pane,
	});
	return {
		ws: target.ws,
		client: {
			browser: {
				list: {
					query: async (input: { workspaceId: string }) =>
						browserBridgeListResultSchema.parse(
							await target.client.direct.browserReadV1.query({
								type: "list",
								workspaceId: input.workspaceId,
							}),
						),
				},
			},
		},
	};
}

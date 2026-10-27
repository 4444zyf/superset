import { msg } from "@lingui/core/macro";
import { CLIError } from "@superset/cli-framework";
import { i18n } from "@superset/i18n";
import { browserBridgeListResultSchema } from "@superset/shared/browser-bridge";
import {
	BrowserCdpNamespaceUnavailableError,
	resolveBrowserCdpNamespace,
} from "./resolveDirectNamespace";

export async function cdpDirectNamespace(options: {
	namespace?: string;
	host?: string;
	workspace: string;
	pane: string;
}) {
	if (options.namespace === undefined) return null;
	if (options.host !== undefined)
		throw new CLIError("Pass either --namespace or --host, not both");
	let target: Awaited<ReturnType<typeof resolveBrowserCdpNamespace>>;
	try {
		target = await resolveBrowserCdpNamespace(options.namespace, {
			workspaceId: options.workspace,
			paneId: options.pane,
		});
	} catch (error) {
		if (!(error instanceof BrowserCdpNamespaceUnavailableError)) throw error;
		throw new CLIError(
			i18n._(
				msg({
					message: "Browser CDP is unavailable for the selected namespace",
				}),
			),
		);
	}
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

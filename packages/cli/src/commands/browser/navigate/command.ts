import { string } from "@superset/cli-framework";
import { command } from "../../../lib/command";
import { namespaceOption } from "../../../lib/direct-namespace";
import {
	navigateDirectNamespace,
	operationIdOption,
} from "../../../lib/direct-namespace/browser-navigation";
import { resolveBrowserTarget } from "../shared";

export default command({
	description: "Navigate an existing browser pane to a URL",
	options: {
		namespace: namespaceOption(),
		operationId: operationIdOption(),
		workspace: string().required().desc("Workspace ID"),
		host: string().desc("Host the workspace lives on (default: this machine)"),
		pane: string().required().desc("Pane ID (from `superset browser list`)"),
		url: string().required().desc("URL to navigate to"),
	},
	run: async ({ ctx, options }) => {
		if (await navigateDirectNamespace(options))
			return { data: { ok: true }, message: `Navigated ${options.pane}` };
		const { client } = await resolveBrowserTarget(ctx, options);
		await client.browser.navigate.mutate({
			workspaceId: options.workspace,
			paneId: options.pane,
			url: options.url,
		});
		return { data: { ok: true }, message: `Navigated ${options.pane}` };
	},
});

import { browserBridgeConsoleResultSchema } from "@superset/shared/browser-bridge";
import { CLIError, number, string } from "@superset/cli-framework";
import { command } from "../../../lib/command";
import {
	namespaceOption,
	readFromDirectNamespace,
} from "../../../lib/direct-namespace";
import { resolveBrowserTarget } from "../shared";

export default command({
	description: "Read a browser pane's captured console output",
	options: {
		namespace: namespaceOption(),
		workspace: string().required().desc("Workspace ID"),
		host: string().desc("Host the workspace lives on (default: this machine)"),
		pane: string().required().desc("Pane ID (from `superset browser list`)"),
		maxLines: number().int().desc("Cap returned entries from the bottom"),
	},
	run: async ({ ctx, options }) => {
		if (options.maxLines != null && options.maxLines < 0) {
			throw new CLIError("--max-lines must be >= 0");
		}
		const direct = await readFromDirectNamespace(options, (target) =>
			target.client.direct.browserReadV1.query({
				type: "console",
				workspaceId: options.workspace,
				paneId: options.pane,
			}),
		);
		const client = direct
			? null
			: (await resolveBrowserTarget(ctx, options)).client;
		const { entries } = direct
			? browserBridgeConsoleResultSchema.parse(direct.value)
			: await client!.browser.console.query({
					workspaceId: options.workspace,
					paneId: options.pane,
				});
		// `!= null` so `--max-lines 0` means zero, not "all".
		const limited =
			options.maxLines != null
				? entries.slice(entries.length - options.maxLines)
				: entries;
		return {
			data: limited,
			message: limited.length
				? limited.map((e) => `[${e.level}] ${e.message}`).join("\n")
				: "No console output captured.",
		};
	},
});

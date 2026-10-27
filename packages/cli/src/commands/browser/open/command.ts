import { boolean, CLIError, string } from "@superset/cli-framework";
import { command } from "../../../lib/command";
import { namespaceOption } from "../../../lib/direct-namespace";
import { operationIdOption } from "../../../lib/direct-namespace/browser-navigation";
import { openDirectNamespace } from "../../../lib/direct-namespace/browser-open";
import { resolveBrowserTarget } from "../shared";

export default command({
	description: "Open a URL in a workspace browser pane and return its pane id",
	options: {
		namespace: namespaceOption(),
		operationId: operationIdOption(),
		show: boolean().desc(
			"Show the browser to the user by switching to its workspace",
		),
		workspace: string().required().desc("Workspace ID"),
		host: string().desc("Host the workspace lives on (default: this machine)"),
		url: string().required().desc("URL to open"),
		target: string().desc("`current-tab` (default) or `new-tab`"),
	},
	run: async ({ ctx, options }) => {
		const direct = await openDirectNamespace(options);
		const client = direct
			? null
			: (await resolveBrowserTarget(ctx, options)).client;
		// Reject typos rather than silently falling back to current-tab.
		if (
			options.target &&
			!["current-tab", "new-tab"].includes(options.target)
		) {
			throw new CLIError(
				`Invalid --target: ${options.target}`,
				"Use `current-tab` or `new-tab`",
			);
		}
		const target = options.target === "new-tab" ? "new-tab" : "current-tab";
		const result =
			direct ??
			(await client!.browser.open.mutate({
				workspaceId: options.workspace,
				url: options.url,
				target,
				show: options.show ?? false,
			}));
		return {
			data: result,
			message: `Opened ${result.url}\npane: ${result.paneId}`,
		};
	},
});

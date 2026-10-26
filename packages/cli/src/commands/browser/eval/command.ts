import { string } from "@superset/cli-framework";
import { command } from "../../../lib/command";
import { namespaceOption } from "../../../lib/direct-namespace";
import { evaluateDirectNamespace } from "../../../lib/direct-namespace/browser-evaluation";
import { operationIdOption } from "../../../lib/direct-namespace/browser-navigation";
import { resolveBrowserTarget } from "../shared";

export default command({
	description: "Evaluate JavaScript in a browser pane and return the result",
	options: {
		namespace: namespaceOption(),
		operationId: operationIdOption(),
		workspace: string().required().desc("Workspace ID"),
		host: string().desc("Host the workspace lives on (default: this machine)"),
		pane: string().required().desc("Pane ID (from `superset browser list`)"),
		code: string().required().desc("JavaScript expression to evaluate"),
	},
	run: async ({ ctx, options }) => {
		const direct = await evaluateDirectNamespace(options);
		const client = direct
			? null
			: (await resolveBrowserTarget(ctx, options)).client;
		const { result } =
			direct ??
			(await client!.browser.eval.mutate({
				workspaceId: options.workspace,
				paneId: options.pane,
				code: options.code,
			}));
		return {
			data: { result },
			message:
				typeof result === "string" ? result : JSON.stringify(result, null, 2),
		};
	},
});

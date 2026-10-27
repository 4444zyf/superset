import { msg } from "@lingui/core/macro";
import { CLIError } from "@superset/cli-framework";
import { i18n } from "@superset/i18n";
import { z } from "zod";
import { resolveBrowserOpenNamespace } from "./resolveDirectNamespace";

const resultSchema = z.object({
	paneId: z
		.string()
		.min(1)
		.max(128)
		.regex(/^[\w-]+$/),
	url: z.string().max(8192),
	title: z.string().max(4096),
});
export async function openDirectNamespace(options: {
	namespace?: string;
	host?: string;
	operationId?: string;
	workspace: string;
	url: string;
	target?: string;
	show?: boolean;
}): Promise<{ paneId: string; url: string; title: string } | null> {
	if (options.namespace === undefined) {
		if (options.operationId !== undefined)
			throw new CLIError(
				i18n._(msg({ message: "--operation-id requires --namespace" })),
			);
		return null;
	}
	if (options.host !== undefined)
		throw new CLIError("Pass either --namespace or --host, not both");
	if (!options.operationId)
		throw new CLIError(
			i18n._(
				msg({ message: "--namespace browser opening requires --operation-id" }),
			),
		);
	const operationId = z.string().uuid().parse(options.operationId),
		target = z
			.enum(["current-tab", "new-tab"])
			.default("current-tab")
			.parse(options.target);
	try {
		const namespace = await resolveBrowserOpenNamespace(options.namespace);
		const receipt = await namespace.client.direct.browserOpenV1.mutate({
			operationId,
			workspaceId: options.workspace,
			url: options.url,
			target,
			show: options.show ?? false,
		});
		if (
			receipt.operationId !== operationId ||
			receipt.procedure !== "browser.openV1" ||
			receipt.status !== "completed" ||
			!resultSchema.safeParse(receipt.result).success
		)
			throw Error(`Browser open receipt: ${receipt.status}`);
		return receipt.result as { paneId: string; url: string; title: string };
	} catch (error) {
		throw new CLIError(
			error instanceof Error ? error.message : String(error),
			i18n._({
				...msg({
					message:
						"Inspect operation {operationId} with browser operation-status before opening another browser pane.",
				}),
				values: { operationId },
			}),
		);
	}
}

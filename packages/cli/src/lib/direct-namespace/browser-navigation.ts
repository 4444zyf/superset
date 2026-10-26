import { msg } from "@lingui/core/macro";
import { CLIError, string } from "@superset/cli-framework";
import { i18n } from "@superset/i18n";
import { z } from "zod";
import { resolveBrowserNavigationNamespace } from "./resolveDirectNamespace";

export function operationIdOption() {
	return string().desc(i18n._(msg({ message: "Operation ID (UUID)" })));
}

export async function navigateDirectNamespace(options: {
	namespace?: string;
	host?: string;
	operationId?: string;
	workspace: string;
	pane: string;
	url: string;
}): Promise<{ ok: true } | null> {
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
				msg({ message: "--namespace navigation requires --operation-id" }),
			),
		);
	const operationId = z.string().uuid().parse(options.operationId);
	try {
		const target = await resolveBrowserNavigationNamespace(options.namespace);
		const receipt = await target.client.direct.browserNavigateV1.mutate({
			operationId,
			workspaceId: options.workspace,
			paneId: options.pane,
			url: options.url,
		});
		if (
			receipt.operationId !== operationId ||
			receipt.procedure !== "browser.navigateV1" ||
			receipt.status !== "completed" ||
			(receipt.result as { ok?: unknown } | undefined)?.ok !== true
		)
			throw new Error(`Navigation receipt: ${receipt.status}`);
		return { ok: true };
	} catch (error) {
		throw new CLIError(
			error instanceof Error ? error.message : String(error),
			i18n._({
				...msg({
					message:
						"Inspect operation {operationId} with browser operation-status before issuing another navigation.",
				}),
				values: { operationId },
			}),
		);
	}
}

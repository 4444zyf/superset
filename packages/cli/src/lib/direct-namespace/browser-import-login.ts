import { msg } from "@lingui/core/macro";
import { CLIError } from "@superset/cli-framework";
import { i18n } from "@superset/i18n";
import {
	browserBridgeCookieImportResultSchema,
	browserBridgeImportSourcesResultSchema,
} from "@superset/shared/browser-bridge";
import { z } from "zod";
import { resolveBrowserImportNamespace } from "./resolveDirectNamespace";

export async function importLoginDirectNamespace(options: {
	namespace?: string;
	host?: string;
	operationId?: string;
	from?: string;
}) {
	if (options.namespace === undefined) {
		if (options.operationId !== undefined)
			throw new CLIError(
				i18n._(msg({ message: "--operation-id requires --namespace" })),
			);
		return null;
	}
	if (options.host !== undefined)
		throw new CLIError("Pass either --namespace or --host, not both");
	if (options.from && !options.operationId)
		throw new CLIError(
			i18n._(
				msg({
					message:
						"--namespace browser login import with --from requires --operation-id",
				}),
			),
		);
	const operationId = z.string().uuid().optional().parse(options.operationId);
	const target = await resolveBrowserImportNamespace(options.namespace);
	return {
		browser: {
			importSources: {
				query: async () =>
					browserBridgeImportSourcesResultSchema.parse(
						await target.client.direct.browserImportSourcesV1.query(),
					),
			},
			importCookies: {
				mutate: async (input: {
					workspaceId: string;
					paneId: string;
					sourceId: string;
				}) => {
					if (!operationId)
						throw Error(
							"A pinned browser login import operation ID is required",
						);
					try {
						const receipt =
							await target.client.direct.browserImportCookiesV1.mutate({
								...input,
								operationId,
							});
						if (
							!receipt ||
							receipt.operationId !== operationId ||
							receipt.procedure !== "browser.importCookiesV1" ||
							receipt.status !== "completed"
						)
							throw Error("Browser cookie import receipt is not completed");
						const result = browserBridgeCookieImportResultSchema.safeParse(
							receipt.result,
						);
						if (!result.success)
							throw Error("Browser cookie import receipt has invalid counts");
						return result.data;
					} catch (error) {
						throw new CLIError(
							error instanceof Error ? error.message : String(error),
							i18n._({
								...msg({
									message:
										"Inspect operation {operationId} with browser operation-status before importing logins again.",
								}),
								values: { operationId },
							}),
						);
					}
				},
			},
		},
	};
}

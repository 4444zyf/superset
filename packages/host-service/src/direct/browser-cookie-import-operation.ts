import { TRPCError } from "@trpc/server";
import { z } from "zod";
import type { DirectOperationStore } from "./operations";

export const browserCookieImportOperationSchema = z.strictObject({
	operationId: z.string().uuid(),
	workspaceId: z.string().min(1).max(256),
	paneId: z.string().min(1).max(256),
	sourceId: z.string().min(1).max(8192),
});
export type BrowserCookieImportInput = Omit<
	z.infer<typeof browserCookieImportOperationSchema>,
	"operationId"
>;
export type PinnedBrowserCookieImport = (() => Promise<{
	imported: number;
	skipped: number;
	keyUnavailable: boolean;
}>) & {
	release?(): void;
};

export function runBrowserCookieImportOperation(
	value: unknown,
	dependencies: {
		operations: Pick<
			DirectOperationStore,
			"status" | "execute" | "assertCanCreate" | "runMutationOperation"
		>;
		pin(input: BrowserCookieImportInput): PinnedBrowserCookieImport;
	},
) {
	const { operationId, ...input } =
		browserCookieImportOperationSchema.parse(value);
	const { operations } = dependencies;
	const procedure = "browser.importCookiesV1";
	if (operations.status(operationId))
		return operations.execute(operationId, procedure, input, () => {
			throw new TRPCError({
				code: "PRECONDITION_FAILED",
				message: "An accepted browser cookie import cannot be rebound",
			});
		});
	operations.assertCanCreate();
	return operations.runMutationOperation(async () => {
		const execute = dependencies.pin(input);
		try {
			return await operations.execute(operationId, procedure, input, execute);
		} finally {
			execute.release?.();
		}
	});
}

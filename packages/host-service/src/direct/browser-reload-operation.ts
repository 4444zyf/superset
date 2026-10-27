import { TRPCError } from "@trpc/server";
import { z } from "zod";
import type { DirectOperationStore } from "./operations";

export const browserReloadOperationSchema = z.strictObject({
	operationId: z.string().uuid(),
	workspaceId: z.string().min(1).max(256),
	paneId: z.string().min(1).max(256),
	hard: z.boolean().default(false),
});
export type BrowserReloadInput = Omit<
	z.infer<typeof browserReloadOperationSchema>,
	"operationId"
>;
export type PinnedBrowserReload = (() => Promise<{ ok: true }>) & {
	release?(): void;
};

export function runBrowserReloadOperation(
	value: unknown,
	dependencies: {
		operations: Pick<
			DirectOperationStore,
			"status" | "execute" | "assertCanCreate" | "runMutationOperation"
		>;
		pin(input: BrowserReloadInput): PinnedBrowserReload;
	},
) {
	const { operationId, ...input } = browserReloadOperationSchema.parse(value);
	const { operations } = dependencies;
	const procedure = "browser.reloadV1";
	if (operations.status(operationId))
		return operations.execute(operationId, procedure, input, () => {
			throw new TRPCError({
				code: "PRECONDITION_FAILED",
				message: "An accepted browser reload cannot be rebound",
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

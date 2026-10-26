import { TRPCError } from "@trpc/server";
import { z } from "zod";
import type { DirectOperationStore } from "./operations";

export const browserNavigationOperationSchema = z.strictObject({
	operationId: z.string().uuid(),
	workspaceId: z.string().min(1).max(256),
	paneId: z.string().min(1).max(256),
	url: z
		.string()
		.min(1)
		.max(8192)
		.regex(/^[^\x00-\x1f\x7f]+$/),
});
export type BrowserNavigationInput = Omit<
	z.infer<typeof browserNavigationOperationSchema>,
	"operationId"
>;
export type PinnedBrowserNavigation = (() => Promise<{ ok: true }>) & {
	release?(): void;
};

export function runBrowserNavigationOperation(
	value: unknown,
	dependencies: {
		operations: Pick<
			DirectOperationStore,
			"status" | "execute" | "assertCanCreate" | "runMutationOperation"
		>;
		pin(input: BrowserNavigationInput): PinnedBrowserNavigation;
	},
) {
	const { operationId, ...input } =
		browserNavigationOperationSchema.parse(value);
	const { operations } = dependencies;
	const procedure = "browser.navigateV1";
	if (operations.status(operationId))
		return operations.execute(operationId, procedure, input, () => {
			throw new TRPCError({
				code: "PRECONDITION_FAILED",
				message: "An accepted browser navigation cannot be rebound",
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

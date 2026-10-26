import { TRPCError } from "@trpc/server";
import { z } from "zod";
import type { DirectOperationStore } from "./operations";

export const browserEvaluationOperationSchema = z.strictObject({
	operationId: z.string().uuid(),
	workspaceId: z.string().min(1).max(256),
	paneId: z.string().min(1).max(256),
	code: z.string().max(1_000_000),
});
export type BrowserEvaluationInput = Omit<
	z.infer<typeof browserEvaluationOperationSchema>,
	"operationId"
>;
export type PinnedBrowserEvaluation = (() => Promise<{ result: unknown }>) & {
	release?(): void;
};

export function runBrowserEvaluationOperation(
	value: unknown,
	dependencies: {
		operations: Pick<
			DirectOperationStore,
			"status" | "execute" | "assertCanCreate" | "runMutationOperation"
		>;
		pin(input: BrowserEvaluationInput): PinnedBrowserEvaluation;
	},
) {
	const { operationId, ...input } =
		browserEvaluationOperationSchema.parse(value);
	const { operations } = dependencies;
	const procedure = "browser.evaluateV1";
	if (operations.status(operationId))
		return operations.execute(operationId, procedure, input, () => {
			throw new TRPCError({
				code: "PRECONDITION_FAILED",
				message: "An accepted browser evaluation cannot be rebound",
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

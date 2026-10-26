import { TRPCError } from "@trpc/server";
import { z } from "zod";
import type { DirectOperationStore } from "./operations";

export const browserOpenOperationSchema = z.strictObject({
	operationId: z.string().uuid(),
	workspaceId: z.string().min(1).max(256),
	url: z
		.string()
		.min(1)
		.max(8192)
		.refine(
			(value) =>
				!Array.from(value).some((character) => {
					const code = character.charCodeAt(0);
					return code < 32 || code === 127;
				}),
		),
	target: z.enum(["current-tab", "new-tab"]).default("current-tab"),
	show: z.boolean().default(false),
});
export type BrowserOpenInput = Omit<
	z.infer<typeof browserOpenOperationSchema>,
	"operationId"
>;
export type PinnedBrowserOpen = (() => Promise<{
	paneId: string;
	url: string;
	title: string;
}>) & {
	release?(): void;
};

export function runBrowserOpenOperation(
	value: unknown,
	dependencies: {
		operations: Pick<
			DirectOperationStore,
			"status" | "execute" | "assertCanCreate" | "runMutationOperation"
		>;
		pin(input: BrowserOpenInput): PinnedBrowserOpen;
	},
) {
	const { operationId, ...input } = browserOpenOperationSchema.parse(value);
	const { operations } = dependencies;
	const procedure = "browser.openV1";
	if (operations.status(operationId))
		return operations.execute(operationId, procedure, input, () => {
			throw new TRPCError({
				code: "PRECONDITION_FAILED",
				message: "An accepted browser open cannot be rebound",
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

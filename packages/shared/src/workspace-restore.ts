import { z } from "zod";

const id = z
	.string()
	.min(1)
	.max(128)
	.regex(/^[\w-]+$/);
export const restoreResourceRefSchema = z.strictObject({
	workspaceId: id,
	resourceId: id,
	kind: z.enum(["terminal", "chat"]),
	executionId: id.optional(),
});
export const restoreResourcesInputSchema = z.strictObject({
	refs: z.array(restoreResourceRefSchema).max(64),
});
export type RestoreResourceRef = z.infer<typeof restoreResourceRefSchema>;
export interface RestoreResourceCheck extends RestoreResourceRef {
	state:
		| "live"
		| "exited"
		| "interrupted"
		| "missing"
		| "workspace-unavailable"
		| "unknown";
	label?: string;
	reason?: "unsupported" | "execution-changed" | "unavailable";
}

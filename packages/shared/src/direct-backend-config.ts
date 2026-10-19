import { isAbsolute } from "node:path";
import { z } from "zod";

const absolutePath = z
	.string()
	.min(1)
	.refine(isAbsolute, "Expected an absolute path");
export const directConfigSchema = z
	.object({
		backendId: z.string().uuid(),
		namespaceId: z.string().uuid(),
		homeDir: absolutePath,
		secretFile: absolutePath,
		migrationsFolder: absolutePath,
		chatMigrationsFolder: absolutePath.optional(),
		hostServicePath: absolutePath.optional(),
		allowedOrigins: z.array(z.string()).default([]),
		installationMode: z.enum(["local", "managed"]).optional(),
	})
	.strict();

export type DirectConfig = z.infer<typeof directConfigSchema>;

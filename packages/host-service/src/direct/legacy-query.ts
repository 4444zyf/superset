import { join } from "node:path";
import { z } from "zod";
import { loadDirectConfig } from "./config";
import {
	listImportedLegacyHistory,
	readImportedLegacyHistory,
} from "./legacy-history";
import { discoverLegacySources, previewLegacySources } from "./legacy-sources";

const path = z
	.string()
	.min(1)
	.max(4096)
	.refine((value) => !/[\0\r\n]/.test(value));
const schema = z.discriminatedUnion("action", [
	z.object({ action: z.literal("discover"), userHomeDirectory: path }).strict(),
	z
		.object({
			action: z.literal("preview"),
			sources: z
				.array(
					z
						.object({
							id: z.string().regex(/^[a-f0-9]{64}$/),
							format: z.enum(["v1", "v2"]),
							sourceDirectory: path,
							sourceNamespace: z.string().min(1).max(255),
						})
						.strict(),
				)
				.max(32),
		})
		.strict(),
	z
		.object({
			action: z.literal("listHistory"),
			offset: z.number().int().nonnegative().optional(),
			limit: z.number().int().min(1).max(100).optional(),
		})
		.strict(),
	z
		.object({
			action: z.literal("readHistory"),
			workspaceId: z.string().uuid(),
			terminalId: z.string().uuid(),
			byteOffset: z.number().int().nonnegative().optional(),
			byteLimit: z.number().int().min(4).max(8192).optional(),
		})
		.strict(),
]);

/** Offline query entry: it never initializes a service, PTY, or chat harness. */
export async function queryLocalLegacyData(
	configPath: string,
	request: unknown,
): Promise<unknown> {
	const config = loadDirectConfig(configPath);
	if (config.installationMode !== "local" || !process.getuid?.())
		throw new Error(
			"Legacy data queries require an ordinary user's local namespace",
		);
	const input = schema.parse(request);
	switch (input.action) {
		case "discover":
			return discoverLegacySources({ userHomeDir: input.userHomeDirectory });
		case "preview":
			return previewLegacySources({
				sources: input.sources,
				stagingDirectory: join(config.homeDir, "state", "legacy-preview"),
			});
		case "listHistory":
			return listImportedLegacyHistory({
				homeDir: config.homeDir,
				namespaceId: config.namespaceId,
				offset: input.offset,
				limit: input.limit,
			});
		case "readHistory":
			return readImportedLegacyHistory({
				homeDir: config.homeDir,
				namespaceId: config.namespaceId,
				workspaceId: input.workspaceId,
				terminalId: input.terminalId,
				byteOffset: input.byteOffset,
				byteLimit: input.byteLimit,
			});
	}
}

import { createHash } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import type { HostDb } from "../../../db";
import { terminalPresetCatalog } from "../../../db/schema";
import { protectedProcedure, router } from "../../index";

const presetFields = z
	.object({
		name: z.string().max(4096),
		description: z.string().max(65536).optional(),
		cwd: z.string().max(32768),
		commands: z.array(z.string().max(65536)).max(128),
		projectIds: z.array(z.string().min(1).max(4096)).max(512).nullable(),
		pinnedToBar: z.boolean().optional(),
		useAsWorkspaceRun: z.boolean().optional(),
		applyOnWorkspaceCreated: z.boolean().optional(),
		applyOnNewTab: z.boolean().optional(),
		executionMode: z.enum([
			"split-pane",
			"new-tab",
			"new-tab-split-pane",
			"sequential",
		]),
		agentId: z.string().min(1).max(4096).optional(),
	})
	.strict();

const presetSchema = presetFields
	.extend({
		id: z.string().uuid(),
		tabOrder: z.number().int().nonnegative(),
		createdAt: z.date(),
	})
	.strict();

export type HostTerminalPreset = z.infer<typeof presetSchema>;
export interface HostTerminalPresetCatalog {
	initialized: boolean;
	presets: HostTerminalPreset[];
	revision: string;
}

const catalogChangeSchema = z
	.object({
		expectedRevision: z.string().regex(/^[a-f0-9]{64}$/),
		change: z.discriminatedUnion("kind", [
			z
				.object({
					kind: z.literal("initialize"),
					presets: z.array(presetSchema).max(512),
				})
				.strict(),
			z.object({ kind: z.literal("add"), preset: presetSchema }).strict(),
			z
				.object({
					kind: z.literal("update"),
					id: z.string().uuid(),
					patch: presetFields.partial().strict(),
				})
				.strict(),
			z.object({ kind: z.literal("remove"), id: z.string().uuid() }).strict(),
			z
				.object({
					kind: z.literal("reorder"),
					ids: z.array(z.string().uuid()).max(512),
				})
				.strict(),
		]),
	})
	.strict();

function readCatalog(db: Pick<HostDb, "select">): HostTerminalPresetCatalog {
	const row = db
		.select()
		.from(terminalPresetCatalog)
		.where(eq(terminalPresetCatalog.id, 1))
		.get();
	const storedSchema = presetSchema.extend({ createdAt: z.coerce.date() });
	return {
		initialized: Boolean(row),
		presets: row
			? z.array(storedSchema).parse(JSON.parse(row.presetsJson))
			: [],
		revision: createHash("sha256")
			.update(JSON.stringify(row ?? null))
			.digest("hex"),
	};
}

export const terminalPresetsRouter = router({
	catalogWithRevisionV1: protectedProcedure.query(({ ctx }) =>
		readCatalog(ctx.db),
	),
	applyCatalogChangeV1: protectedProcedure
		.input(catalogChangeSchema)
		.mutation(({ ctx, input }) =>
			ctx.db.transaction((tx) => {
				const before = readCatalog(tx);
				if (before.revision !== input.expectedRevision)
					throw new TRPCError({
						code: "CONFLICT",
						message: "Terminal scripts changed. Reload before saving.",
					});
				const { change } = input;
				if (change.kind === "initialize" && before.initialized)
					throw new TRPCError({
						code: "CONFLICT",
						message: "Terminal scripts are already initialized.",
					});
				if (change.kind !== "initialize" && !before.initialized)
					throw new TRPCError({
						code: "PRECONDITION_FAILED",
						message: "Initialize terminal scripts before editing.",
					});
				let presets = before.presets;
				if (change.kind === "initialize") presets = change.presets;
				else if (change.kind === "add") {
					if (presets.some((row) => row.id === change.preset.id))
						throw new TRPCError({
							code: "CONFLICT",
							message: "This terminal script already exists.",
						});
					presets = [...presets, change.preset];
				} else if (change.kind === "reorder") {
					const byId = new Map(presets.map((row) => [row.id, row]));
					if (
						change.ids.length !== presets.length ||
						new Set(change.ids).size !== presets.length ||
						change.ids.some((id) => !byId.has(id))
					)
						throw new TRPCError({
							code: "BAD_REQUEST",
							message: "Reorder requires every terminal script exactly once.",
						});
					presets = change.ids.map((id) => byId.get(id)!);
				} else {
					if (!presets.some((row) => row.id === change.id))
						throw new TRPCError({
							code: "NOT_FOUND",
							message: "Terminal script not found.",
						});
					presets =
						change.kind === "remove"
							? presets.filter((row) => row.id !== change.id)
							: presets.map((row) =>
									row.id === change.id ? { ...row, ...change.patch } : row,
								);
				}
				if (
					presets.length > 512 ||
					new Set(presets.map((row) => row.id)).size !== presets.length
				)
					throw new TRPCError({
						code: "BAD_REQUEST",
						message:
							"Terminal scripts must have unique IDs and at most 512 entries.",
					});
				presets = presets.map((row, tabOrder) => ({ ...row, tabOrder }));
				const presetsJson = JSON.stringify(presets);
				if (Buffer.byteLength(presetsJson, "utf8") > 4 * 1024 * 1024)
					throw new TRPCError({
						code: "BAD_REQUEST",
						message: "Terminal scripts exceed the 4 MiB storage limit.",
					});
				const stored = tx
					.select()
					.from(terminalPresetCatalog)
					.where(eq(terminalPresetCatalog.id, 1))
					.get();
				tx.insert(terminalPresetCatalog)
					.values({ id: 1, presetsJson, revision: (stored?.revision ?? 0) + 1 })
					.onConflictDoUpdate({
						target: terminalPresetCatalog.id,
						set: { presetsJson, revision: (stored?.revision ?? 0) + 1 },
					})
					.run();
				return readCatalog(tx);
			}),
		),
});

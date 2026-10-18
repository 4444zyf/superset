import { createHash, randomUUID } from "node:crypto";
import type { PromptTransport } from "@superset/shared/agent-prompt-launch";
import {
	getDefaultSeedPresets,
	getPresetById,
	type HostAgentPreset,
} from "@superset/shared/host-agent-presets";
import { TRPCError } from "@trpc/server";
import { asc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import type { HostDb } from "../../../db";
import { hostAgentConfigs, hostSettings } from "../../../db/schema";
import { protectedProcedure, router } from "../../index";

const promptTransportSchema = z.enum(["argv", "stdin"]);

const argvSchema = z.array(z.string());
const envSchema = z.record(z.string(), z.string());

export interface HostAgentConfig {
	id: string;
	presetId: string;
	/** Built-in icon key to render, or null to fall back to `presetId`. */
	iconId: string | null;
	label: string;
	command: string;
	args: string[];
	promptTransport: PromptTransport;
	promptArgs: string[];
	/** Args that resume a previous session; the session id is appended after
	 * them. Empty when the agent has no id-based resume. */
	resumeArgs: string[];
	/** Args that clone a previous session. `{sessionId}` marks the id position;
	 * otherwise it is appended. Empty when native forks are unsupported. */
	forkArgs: string[];
	env: Record<string, string>;
	order: number;
}

interface HostAgentConfigRow {
	id: string;
	presetId: string;
	iconId: string | null;
	label: string;
	command: string;
	argsJson: string;
	promptTransport: string;
	promptArgsJson: string;
	resumeArgsJson: string;
	forkArgsJson: string;
	envJson: string;
	displayOrder: number;
}

function parseArgv(value: string): string[] {
	let parsed: unknown;
	try {
		parsed = JSON.parse(value);
	} catch {
		return [];
	}
	if (
		!Array.isArray(parsed) ||
		parsed.some((item) => typeof item !== "string")
	) {
		return [];
	}
	return parsed as string[];
}

function parseEnv(value: string): Record<string, string> {
	let parsed: unknown;
	try {
		parsed = JSON.parse(value);
	} catch {
		return {};
	}
	if (
		parsed === null ||
		typeof parsed !== "object" ||
		Array.isArray(parsed) ||
		Object.values(parsed).some((item) => typeof item !== "string")
	) {
		return {};
	}
	return parsed as Record<string, string>;
}

function toOutput(row: HostAgentConfigRow): HostAgentConfig {
	return {
		id: row.id,
		presetId: row.presetId,
		iconId: row.iconId ?? null,
		label: row.label,
		command: row.command,
		args: parseArgv(row.argsJson),
		promptTransport: row.promptTransport as PromptTransport,
		promptArgs: parseArgv(row.promptArgsJson),
		resumeArgs: parseArgv(row.resumeArgsJson),
		forkArgs: parseArgv(row.forkArgsJson),
		env: parseEnv(row.envJson),
		order: row.displayOrder,
	};
}

function rowFromPreset(
	preset: HostAgentPreset,
	displayOrder: number,
): typeof hostAgentConfigs.$inferInsert {
	return {
		id: randomUUID(),
		presetId: preset.presetId,
		iconId: null,
		label: preset.label,
		command: preset.command,
		argsJson: JSON.stringify(preset.args),
		promptTransport: preset.promptTransport,
		promptArgsJson: JSON.stringify(preset.promptArgs),
		resumeArgsJson: JSON.stringify(preset.resumeArgs),
		forkArgsJson: JSON.stringify(preset.forkArgs),
		envJson: JSON.stringify(preset.env),
		displayOrder,
	};
}

function listOrdered(db: Pick<HostDb, "select">): HostAgentConfigRow[] {
	return db
		.select()
		.from(hostAgentConfigs)
		.orderBy(asc(hostAgentConfigs.displayOrder))
		.all();
}

/**
 * Exported for the sandbox boot: a freshly forked cloud workspace launches
 * an agent before any client has listed its agents, which is what normally
 * seeds the defaults.
 */
export function seedDefaultsIfEmpty(
	db: Pick<HostDb, "select" | "insert">,
): HostAgentConfigRow[] {
	const existing = listOrdered(db);
	if (existing.length > 0) return existing;
	const seeds = getDefaultSeedPresets().map((preset, index) =>
		rowFromPreset(preset, index),
	);
	if (seeds.length === 0) return existing;
	db.insert(hostAgentConfigs).values(seeds).run();
	return listOrdered(db);
}

/**
 * Defaults are seeded once, when the table is empty, so an install that
 * predates a preset gaining fork support would keep an empty `forkArgs`
 * forever and silently offer no fork for a harness whose CLI can do it.
 *
 * Only rows still identical to their preset are filled in: if someone has
 * edited an agent's launch settings, their row is theirs. The one case this
 * cannot tell apart is an untouched agent whose fork args were deliberately
 * cleared, which comes back on the next read; re-enabling a menu item is a
 * small enough wrong to prefer over a schema change to record the intent.
 */
function backfillPresetForkArgs(
	db: HostDb,
	rows: HostAgentConfigRow[],
): HostAgentConfigRow[] {
	let changed = false;
	for (const row of rows) {
		if (parseArgv(row.forkArgsJson).length > 0) continue;
		const preset = getPresetById(row.presetId);
		if (!preset || preset.forkArgs.length === 0) continue;
		if (!rowMatchesPresetLaunch(row, preset)) continue;
		db.update(hostAgentConfigs)
			.set({ forkArgsJson: JSON.stringify(preset.forkArgs) })
			.where(eq(hostAgentConfigs.id, row.id))
			.run();
		changed = true;
	}
	return changed ? listOrdered(db) : rows;
}

/** Whether a row's launch settings are still exactly what the preset ships. */
function rowMatchesPresetLaunch(
	row: HostAgentConfigRow,
	preset: HostAgentPreset,
): boolean {
	const sameArgv = (json: string, args: string[]) => {
		const parsed = parseArgv(json);
		return (
			parsed.length === args.length &&
			parsed.every((value, index) => value === args[index])
		);
	};
	return (
		row.command === preset.command &&
		row.promptTransport === preset.promptTransport &&
		sameArgv(row.argsJson, preset.args) &&
		sameArgv(row.promptArgsJson, preset.promptArgs) &&
		sameArgv(row.resumeArgsJson, preset.resumeArgs)
	);
}

// An icon override is either a built-in icon key ("claude") or an uploaded
// `data:` image URI. Capped so an oversized upload can't bloat the per-machine
// SQLite DB — the client downscales images before sending.
const MAX_ICON_ID_LENGTH = 256 * 1024;
const iconIdSchema = z.string().trim().min(1).max(MAX_ICON_ID_LENGTH);
// `null` clears the icon override (fall back to `presetId`); a string sets it.
const iconIdPatchSchema = iconIdSchema.nullable();

const updatePatchSchema = z
	.object({
		label: z.string().trim().min(1).optional(),
		command: z.string().trim().min(1).optional(),
		args: argvSchema.optional(),
		promptTransport: promptTransportSchema.optional(),
		promptArgs: argvSchema.optional(),
		resumeArgs: argvSchema.optional(),
		forkArgs: argvSchema.optional(),
		env: envSchema.optional(),
		iconId: iconIdPatchSchema.optional(),
	})
	.refine(
		(patch) =>
			patch.label !== undefined ||
			patch.command !== undefined ||
			patch.args !== undefined ||
			patch.promptTransport !== undefined ||
			patch.promptArgs !== undefined ||
			patch.resumeArgs !== undefined ||
			patch.forkArgs !== undefined ||
			patch.env !== undefined ||
			patch.iconId !== undefined,
		{ message: "Patch must update at least one field" },
	);

function updateAgentConfig(
	db: Pick<HostDb, "select" | "update">,
	input: { id: string; patch: z.infer<typeof updatePatchSchema> },
): HostAgentConfig {
	const existing = db
		.select()
		.from(hostAgentConfigs)
		.where(eq(hostAgentConfigs.id, input.id))
		.get();
	if (!existing) {
		throw new TRPCError({
			code: "NOT_FOUND",
			message: `Host agent config not found: ${input.id}`,
		});
	}
	const update: Partial<typeof hostAgentConfigs.$inferInsert> = {
		updatedAt: Date.now(),
	};
	if (input.patch.label !== undefined) update.label = input.patch.label;
	if (input.patch.command !== undefined) update.command = input.patch.command;
	if (input.patch.args !== undefined)
		update.argsJson = JSON.stringify(input.patch.args);
	if (input.patch.promptTransport !== undefined)
		update.promptTransport = input.patch.promptTransport;
	if (input.patch.promptArgs !== undefined)
		update.promptArgsJson = JSON.stringify(input.patch.promptArgs);
	if (input.patch.resumeArgs !== undefined)
		update.resumeArgsJson = JSON.stringify(input.patch.resumeArgs);
	if (input.patch.forkArgs !== undefined)
		update.forkArgsJson = JSON.stringify(input.patch.forkArgs);
	if (input.patch.env !== undefined)
		update.envJson = JSON.stringify(input.patch.env);
	if (input.patch.iconId !== undefined) update.iconId = input.patch.iconId;
	db.update(hostAgentConfigs)
		.set(update)
		.where(eq(hostAgentConfigs.id, input.id))
		.run();
	const updated = db
		.select()
		.from(hostAgentConfigs)
		.where(eq(hostAgentConfigs.id, input.id))
		.get();
	if (!updated) {
		throw new TRPCError({
			code: "INTERNAL_SERVER_ERROR",
			message: "Failed to read back updated host agent config",
		});
	}
	return toOutput(updated);
}

function versionedAgentConfig(db: Pick<HostDb, "select">, id: string) {
	const row = db
		.select()
		.from(hostAgentConfigs)
		.where(eq(hostAgentConfigs.id, id))
		.get();
	if (!row)
		throw new TRPCError({
			code: "NOT_FOUND",
			message: `Host agent config not found: ${id}`,
		});
	return {
		config: toOutput(row),
		revision: createHash("sha256").update(JSON.stringify(row)).digest("hex"),
	};
}

const addInputSchema = z.object({
	label: z.string().trim().min(1),
	command: z.string().trim().min(1),
	args: argvSchema,
	promptTransport: promptTransportSchema,
	promptArgs: argvSchema,
	// Defaulted so an older desktop client that doesn't send it can still add.
	resumeArgs: argvSchema.default([]),
	forkArgs: argvSchema.default([]),
	env: envSchema,
	presetId: z.string().trim().min(1).optional(),
	iconId: iconIdSchema.optional(),
});

type AgentConfigDb = Pick<HostDb, "select" | "insert" | "update" | "delete">;

function addAgentConfig(
	db: AgentConfigDb,
	input: z.infer<typeof addInputSchema>,
	id: string = randomUUID(),
) {
	const existing = listOrdered(db);
	const nextOrder =
		existing.length === 0
			? 0
			: Math.max(...existing.map((row) => row.displayOrder)) + 1;
	db.insert(hostAgentConfigs)
		.values({
			id,
			presetId: input.presetId ?? "custom",
			iconId: input.iconId ?? null,
			label: input.label,
			command: input.command,
			argsJson: JSON.stringify(input.args),
			promptTransport: input.promptTransport,
			promptArgsJson: JSON.stringify(input.promptArgs),
			resumeArgsJson: JSON.stringify(input.resumeArgs),
			forkArgsJson: JSON.stringify(input.forkArgs),
			envJson: JSON.stringify(input.env),
			displayOrder: nextOrder,
		})
		.run();
	const created = db
		.select()
		.from(hostAgentConfigs)
		.where(eq(hostAgentConfigs.id, id))
		.get();
	if (!created) {
		throw new TRPCError({
			code: "INTERNAL_SERVER_ERROR",
			message: "Failed to read back inserted host agent config",
		});
	}
	return toOutput(created);
}

function restoreAgentDefault(db: AgentConfigDb, input: { id: string }) {
	const existing = db
		.select()
		.from(hostAgentConfigs)
		.where(eq(hostAgentConfigs.id, input.id))
		.get();
	if (!existing) {
		throw new TRPCError({
			code: "NOT_FOUND",
			message: `Host agent config not found: ${input.id}`,
		});
	}

	const preset = getPresetById(existing.presetId);
	if (!preset) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: `Agent config '${input.id}' has no bundled default`,
		});
	}

	db.update(hostAgentConfigs)
		.set({
			iconId: null,
			label: preset.label,
			command: preset.command,
			argsJson: JSON.stringify(preset.args),
			promptTransport: preset.promptTransport,
			promptArgsJson: JSON.stringify(preset.promptArgs),
			resumeArgsJson: JSON.stringify(preset.resumeArgs),
			forkArgsJson: JSON.stringify(preset.forkArgs),
			envJson: JSON.stringify(preset.env),
			updatedAt: Date.now(),
		})
		.where(eq(hostAgentConfigs.id, input.id))
		.run();

	const restored = db
		.select()
		.from(hostAgentConfigs)
		.where(eq(hostAgentConfigs.id, input.id))
		.get();
	if (!restored) {
		throw new TRPCError({
			code: "INTERNAL_SERVER_ERROR",
			message: "Failed to read back restored host agent config",
		});
	}
	return toOutput(restored);
}

function removeAgentConfig(db: AgentConfigDb, input: { id: string }) {
	const existing = db
		.select({ id: hostAgentConfigs.id })
		.from(hostAgentConfigs)
		.where(eq(hostAgentConfigs.id, input.id))
		.get();
	if (!existing) {
		throw new TRPCError({
			code: "NOT_FOUND",
			message: `Host agent config not found: ${input.id}`,
		});
	}
	db.delete(hostAgentConfigs).where(eq(hostAgentConfigs.id, input.id)).run();
	return { success: true as const };
}

function reorderAgentConfigs(db: AgentConfigDb, input: { ids: string[] }) {
	const existing = listOrdered(db);
	const existingIds = new Set(existing.map((row) => row.id));
	const inputIds = new Set(input.ids);
	if (inputIds.size !== input.ids.length) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: "Reorder ids must be unique",
		});
	}
	if (
		existingIds.size !== inputIds.size ||
		input.ids.some((id) => !existingIds.has(id))
	) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: "Reorder ids must match existing configs exactly",
		});
	}
	const now = Date.now();
	input.ids.forEach((id, index) => {
		db.update(hostAgentConfigs)
			.set({ displayOrder: index, updatedAt: now })
			.where(eq(hostAgentConfigs.id, id))
			.run();
	});
	return listOrdered(db).map(toOutput);
}

function resetAgentConfigs(db: AgentConfigDb) {
	const existing = db
		.select({ id: hostAgentConfigs.id })
		.from(hostAgentConfigs)
		.all();
	if (existing.length > 0) {
		db.delete(hostAgentConfigs)
			.where(
				inArray(
					hostAgentConfigs.id,
					existing.map((row) => row.id),
				),
			)
			.run();
	}
	const seeds = getDefaultSeedPresets().map((preset, index) =>
		rowFromPreset(preset, index),
	);
	if (seeds.length > 0) {
		db.insert(hostAgentConfigs).values(seeds).run();
	}
	return listOrdered(db).map(toOutput);
}

function versionedAgentCatalog(db: Pick<HostDb, "select">) {
	const rows = listOrdered(db);
	return {
		configs: rows.map(toOutput),
		revision: createHash("sha256").update(JSON.stringify(rows)).digest("hex"),
	};
}

const catalogChangeInputSchema = z.object({
	expectedRevision: z.string().regex(/^[a-f0-9]{64}$/),
	change: z.discriminatedUnion("kind", [
		z.object({
			kind: z.literal("add"),
			id: z.string().uuid(),
			config: addInputSchema,
		}),
		z.object({ kind: z.literal("remove"), id: z.string().min(1) }),
		z.object({ kind: z.literal("restore"), id: z.string().min(1) }),
		z.object({
			kind: z.literal("reorder"),
			ids: z.array(z.string().min(1)).min(1),
		}),
		z.object({ kind: z.literal("reset") }),
	]),
});
function applyAgentCatalogChange(
	db: AgentConfigDb,
	input: z.infer<typeof catalogChangeInputSchema>,
) {
	const before = versionedAgentCatalog(db);
	if (before.revision !== input.expectedRevision)
		throw new TRPCError({
			code: "CONFLICT",
			message: "Agent configuration changed",
		});
	const change = input.change;
	switch (change.kind) {
		case "add": {
			if (before.configs.some((c) => c.id === change.id))
				throw new TRPCError({
					code: "CONFLICT",
					message: "Agent configuration changed",
				});
			addAgentConfig(db, change.config, change.id);
			break;
		}
		case "remove":
			removeAgentConfig(db, change);
			break;
		case "restore":
			restoreAgentDefault(db, change);
			break;
		case "reorder":
			reorderAgentConfigs(db, change);
			break;
		case "reset":
			resetAgentConfigs(db);
			break;
	}
	return versionedAgentCatalog(db);
}
function initializeAgentCatalog(db: AgentConfigDb) {
	const state = db
		.select({ initialized: hostSettings.agentCatalogInitialized })
		.from(hostSettings)
		.where(eq(hostSettings.id, 1))
		.get();
	if (state?.initialized) return;
	seedDefaultsIfEmpty(db);
	db.insert(hostSettings)
		.values({ id: 1, agentCatalogInitialized: true })
		.onConflictDoUpdate({
			target: hostSettings.id,
			set: { agentCatalogInitialized: true },
		})
		.run();
}

export const agentConfigsRouter = router({
	catalogWithRevisionV1: protectedProcedure.query(({ ctx }) => {
		backfillPresetForkArgs(ctx.db, seedDefaultsIfEmpty(ctx.db));
		return versionedAgentCatalog(ctx.db);
	}),
	applyCatalogChangeV1: protectedProcedure
		.input(catalogChangeInputSchema)
		.mutation(({ ctx, input }) =>
			ctx.db.transaction((tx) => applyAgentCatalogChange(tx, input)),
		),
	catalogWithRevisionV2: protectedProcedure.query(({ ctx }) =>
		ctx.db.transaction((tx) => {
			initializeAgentCatalog(tx);
			return versionedAgentCatalog(tx);
		}),
	),
	applyCatalogChangeV2: protectedProcedure
		.input(catalogChangeInputSchema)
		.mutation(({ ctx, input }) =>
			ctx.db.transaction((tx) => {
				initializeAgentCatalog(tx);
				return applyAgentCatalogChange(tx, input);
			}),
		),

	/**
	 * List configured host agents in persisted order. Seeds bundled defaults
	 * on first call when no configs exist.
	 */
	list: protectedProcedure.query(({ ctx }) => {
		const rows = backfillPresetForkArgs(ctx.db, seedDefaultsIfEmpty(ctx.db));
		return rows.map(toOutput);
	}),

	/**
	 * Insert a configured host-agent row. Callers pass the full launch shape;
	 * `presetId` is a free-form metadata tag the client uses for description
	 * lookup (and as the icon fallback), defaulting to `"custom"` when omitted.
	 * `iconId` optionally overrides the rendered icon with a built-in icon key
	 * (used by user-authored agents, whose `presetId` is `"custom"`). Duplicate
	 * `presetId` values are allowed — each row gets a fresh `id`.
	 */
	add: protectedProcedure.input(addInputSchema).mutation(({ ctx, input }) => {
		return addAgentConfig(ctx.db, input);
	}),

	getWithRevisionV1: protectedProcedure
		.input(z.object({ id: z.string().min(1) }))
		.query(({ ctx, input }) => versionedAgentConfig(ctx.db, input.id)),

	updateWithRevisionV1: protectedProcedure
		.input(
			z.object({
				id: z.string().min(1),
				expectedRevision: z.string().regex(/^[a-f0-9]{64}$/),
				patch: updatePatchSchema,
			}),
		)
		.mutation(({ ctx, input }) =>
			ctx.db.transaction((tx) => {
				const before = versionedAgentConfig(tx, input.id);
				if (before.revision !== input.expectedRevision)
					throw new TRPCError({
						code: "CONFLICT",
						message: "Agent configuration changed",
					});
				updateAgentConfig(tx, input);
				return versionedAgentConfig(tx, input.id);
			}),
		),

	/**
	 * Update editable fields on an existing config. `presetId` and `order`
	 * are not mutable.
	 */
	update: protectedProcedure
		.input(
			z.object({
				id: z.string().min(1),
				patch: updatePatchSchema,
			}),
		)
		.mutation(({ ctx, input }) => {
			return updateAgentConfig(ctx.db, input);
		}),

	/**
	 * Restore one configured built-in agent to the bundled definition while
	 * preserving its stable id and display order. This repairs stale defaults
	 * without replacing unrelated custom agents or breaking linked presets.
	 */
	restoreDefault: protectedProcedure
		.input(z.object({ id: z.string().min(1) }))
		.mutation(({ ctx, input }) => {
			return restoreAgentDefault(ctx.db, input);
		}),

	/** Delete a single host agent config by id. Throws NOT_FOUND if missing. */
	remove: protectedProcedure
		.input(z.object({ id: z.string().min(1) }))
		.mutation(({ ctx, input }) => {
			return removeAgentConfig(ctx.db, input);
		}),

	/**
	 * Persist a new ordering. The submitted ids must match the current
	 * configured ids exactly — no additions, no removals, no duplicates.
	 * All updates run in a single transaction so a crash mid-loop can't
	 * leave displayOrder half-updated.
	 */
	reorder: protectedProcedure
		.input(z.object({ ids: z.array(z.string().min(1)).min(1) }))
		.mutation(({ ctx, input }) => {
			return ctx.db.transaction((tx) => reorderAgentConfigs(tx, input));
		}),

	/**
	 * Replace the current configs with the bundled defaults. Wrapped in a
	 * transaction so a crash between delete and insert can't leave the
	 * table empty.
	 */
	resetToDefaults: protectedProcedure.mutation(({ ctx }) => {
		return ctx.db.transaction((tx) => resetAgentConfigs(tx));
	}),
});

import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { hostSettings } from "../../../db/schema";
import type { HostServiceContext } from "../../../types";
import { protectedProcedure, router } from "../../index";
import {
	defaultWorktreesRoot,
	normalizeWorktreeBaseDir,
} from "../workspace-creation/shared/worktree-paths";

const HOST_SETTINGS_ID = 1;
// Set by the desktop coordinator from the v1 user setting so a first-run
// host-service inherits the previous worktree location instead of silently
// falling back to the default.
const LEGACY_WORKTREE_BASE_DIR_ENV = "SUPERSET_LEGACY_WORKTREE_BASE_DIR";

export interface HostWorktreeLocationSettings {
	worktreeBaseDir: string | null;
	defaultWorktreeBaseDir: string;
}

function toOutput(
	worktreeBaseDir: string | null,
): HostWorktreeLocationSettings {
	return {
		worktreeBaseDir,
		defaultWorktreeBaseDir: defaultWorktreesRoot(),
	};
}

export function getHostWorktreeBaseDir(
	ctx: Pick<HostServiceContext, "db" | "direct">,
): string | null {
	if (ctx.direct) return null;
	const existing = ctx.db
		.select({ worktreeBaseDir: hostSettings.worktreeBaseDir })
		.from(hostSettings)
		.where(eq(hostSettings.id, HOST_SETTINGS_ID))
		.get();
	if (existing) return existing.worktreeBaseDir ?? null;

	// v1 didn't validate paths, so a malformed legacy value shouldn't brick
	// the first .get() — treat anything that won't normalize as "no legacy".
	let legacy: string | null = null;
	try {
		legacy = normalizeWorktreeBaseDir(
			process.env[LEGACY_WORKTREE_BASE_DIR_ENV],
		);
	} catch {}
	ctx.db
		.insert(hostSettings)
		.values({ id: HOST_SETTINGS_ID, worktreeBaseDir: legacy })
		.run();
	return legacy;
}

export function getProjectWorktreeBaseDir(
	ctx: Pick<HostServiceContext, "db" | "direct">,
	project: { worktreeBaseDir: string | null },
): string | null {
	return ctx.direct
		? defaultWorktreesRoot()
		: (project.worktreeBaseDir ?? getHostWorktreeBaseDir(ctx));
}

export function normalizeHostWorktreeBaseDir(
	ctx: Pick<HostServiceContext, "direct">,
	path: string | null,
): string | null {
	const normalized = normalizeWorktreeBaseDir(path);
	if (!ctx.direct) return normalized;
	if (normalized !== null && normalized !== defaultWorktreesRoot()) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: `Worktrees are managed in ${defaultWorktreesRoot()}`,
		});
	}
	return null;
}

export const worktreeLocationRouter = router({
	get: protectedProcedure.query(({ ctx }) =>
		toOutput(getHostWorktreeBaseDir(ctx)),
	),

	set: protectedProcedure
		.input(z.object({ path: z.string().nullable() }))
		.mutation(({ ctx, input }) => {
			const worktreeBaseDir = normalizeHostWorktreeBaseDir(ctx, input.path);
			ctx.db
				.insert(hostSettings)
				.values({ id: HOST_SETTINGS_ID, worktreeBaseDir })
				.onConflictDoUpdate({
					target: hostSettings.id,
					set: { worktreeBaseDir },
				})
				.run();
			return toOutput(worktreeBaseDir);
		}),
});

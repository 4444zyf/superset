import type {
	RestoreResourceCheck,
	RestoreResourceRef,
} from "@superset/shared/workspace-restore";
import { eq } from "drizzle-orm";
import type { HostServiceContext } from "../types";
import { projects, terminalSessions, workspaces } from "../db/schema";
import { connectExistingDaemon } from "./daemon-client-singleton";

interface RestoreRows {
	workspace(id: string): { archived: boolean } | null;
	terminal(
		id: string,
	): { workspaceId: string | null; status: string; disposing: boolean } | null;
	chat(id: string): Promise<{ workspaceId: string; label?: string } | null>;
}
interface DaemonExecution {
	id: string;
	executionId?: string;
	alive: boolean;
}

export async function inspectRestoreResources(
	refs: RestoreResourceRef[],
	rows: RestoreRows,
	enumerate: () => Promise<DaemonExecution[]>,
): Promise<RestoreResourceCheck[]> {
	let executions: DaemonExecution[] | null = null;
	if (refs.some((ref) => ref.kind === "terminal")) {
		try {
			executions = await enumerate();
		} catch {
			executions = null;
		}
	}
	return Promise.all(
		refs.map(async (ref): Promise<RestoreResourceCheck> => {
			const workspace = rows.workspace(ref.workspaceId);
			if (!workspace || workspace.archived)
				return { ...ref, state: "workspace-unavailable" };
			if (ref.kind === "chat") {
				try {
					const chat = await rows.chat(ref.resourceId);
					return !chat || chat.workspaceId !== ref.workspaceId
						? { ...ref, state: "missing" }
						: {
								...ref,
								state: "live",
								...(chat.label ? { label: chat.label } : {}),
							};
				} catch {
					return { ...ref, state: "unknown", reason: "unavailable" };
				}
			}
			const terminal = rows.terminal(ref.resourceId);
			if (!terminal || terminal.workspaceId !== ref.workspaceId)
				return { ...ref, state: "missing" };
			if (terminal.status !== "active" || terminal.disposing)
				return { ...ref, state: "exited" };
			if (executions === null)
				return { ...ref, state: "unknown", reason: "unavailable" };
			const execution = executions.find((row) => row.id === ref.resourceId);
			if (
				execution &&
				!execution.alive &&
				execution.executionId === ref.executionId
			)
				return { ...ref, state: "exited" };
			if (!execution?.alive) return { ...ref, state: "interrupted" };
			if (!execution.executionId)
				return { ...ref, state: "unknown", reason: "unsupported" };
			if (ref.executionId && ref.executionId !== execution.executionId)
				return { ...ref, state: "interrupted", reason: "execution-changed" };
			return { ...ref, executionId: execution.executionId, state: "live" };
		}),
	);
}

export async function restoreResources(
	ctx: Pick<HostServiceContext, "db" | "runtime">,
	refs: RestoreResourceRef[],
): Promise<RestoreResourceCheck[]> {
	return inspectRestoreResources(
		refs,
		{
			workspace(id) {
				const w = ctx.db.query.workspaces
					.findFirst({ where: eq(workspaces.id, id) })
					.sync();
				if (!w) return null;
				const p = w.projectId
					? ctx.db.query.projects
							.findFirst({ where: eq(projects.id, w.projectId) })
							.sync()
					: null;
				return { archived: w.archivedAt !== null || !!p?.deletedAt };
			},
			terminal(id) {
				const row = ctx.db.query.terminalSessions
					.findFirst({ where: eq(terminalSessions.id, id) })
					.sync();
				return row
					? {
							workspaceId: row.originWorkspaceId,
							status: row.status,
							disposing: row.disposeRequestedAt !== null,
						}
					: null;
			},
			async chat(id) {
				if (!ctx.runtime.chat) throw new Error("Chat history is unavailable");
				const row = ctx.runtime.chat().sessions.get(id);
				return row
					? {
							workspaceId: row.scopeId,
							...(row.title ? { label: row.title } : {}),
						}
					: null;
			},
		},
		async () => {
			const daemon = await connectExistingDaemon();
			try {
				if (!daemon.supportsConditionalSubscribe)
					throw new Error("Strict terminal restore is unsupported");
				return await daemon.list();
			} finally {
				await daemon.dispose();
			}
		},
	);
}

export async function supportsWorkspaceRestore(): Promise<boolean> {
	try {
		const daemon = await connectExistingDaemon();
		try {
			return daemon.supportsConditionalSubscribe;
		} finally {
			await daemon.dispose();
		}
	} catch {
		return false;
	}
}

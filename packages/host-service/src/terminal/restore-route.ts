import type { NodeWebSocket } from "@hono/node-ws";
import { restoreResourceRefSchema } from "@superset/shared/workspace-restore";
import { TerminalModes } from "@superset/pty-daemon/terminal-modes";
import { eq } from "drizzle-orm";
import type { Hono } from "hono";
import type { WSContext } from "hono/ws";
import type { HostDb } from "../db";
import { projects, terminalSessions, workspaces } from "../db/schema";
import { connectExistingDaemon } from "./daemon-client-singleton";
import type { DaemonClient } from "./DaemonClient";

export function registerTerminalRestoreRoute(
	app: Hono,
	db: HostDb,
	upgrade: NodeWebSocket["upgradeWebSocket"],
): void {
	app.get(
		"/terminal-restore/:terminalId",
		upgrade((c) => {
			const parsed = restoreResourceRefSchema.safeParse({
				kind: "terminal",
				resourceId: c.req.param("terminalId"),
				workspaceId: c.req.query("workspaceId"),
				executionId: c.req.query("executionId"),
			});
			let daemon: DaemonClient | null = null;
			let ready = false;
			let closed = false;
			let unsubscribe: (() => void) | undefined;
			const cleanup = () => {
				closed = true;
				ready = false;
				try {
					unsubscribe?.();
				} catch {}
				void daemon?.dispose().catch(() => {});
			};
			const fail = (ws: WSContext, code: string) => {
				if (!closed) {
					ws.send(JSON.stringify({ type: "error", code, message: code }));
					ws.close(1008, code);
				}
				cleanup();
			};
			const allowed = () => {
				if (!parsed.success || !parsed.data.executionId) return false;
				const ref = parsed.data;
				const w = db.query.workspaces
					.findFirst({ where: eq(workspaces.id, ref.workspaceId) })
					.sync();
				const row = db.query.terminalSessions
					.findFirst({ where: eq(terminalSessions.id, ref.resourceId) })
					.sync();
				const p = w?.projectId
					? db.query.projects
							.findFirst({ where: eq(projects.id, w.projectId) })
							.sync()
					: null;
				return (
					!!w &&
					w.archivedAt === null &&
					!p?.deletedAt &&
					row?.originWorkspaceId === ref.workspaceId &&
					row.status === "active" &&
					row.disposeRequestedAt === null
				);
			};
			return {
				async onOpen(_event, ws) {
					if (!parsed.success || !parsed.data.executionId || !allowed())
						return fail(ws, "RESOURCE_UNAVAILABLE");
					const ref = parsed.data;
					const backlog: Uint8Array[] = [];
					let bytes = 0;
					const output = (chunk: Uint8Array) => {
						if (closed) return;
						if (
							Number(
								(ws.raw as { bufferedAmount?: number } | undefined)
									?.bufferedAmount ?? 0,
							) >
							2 * 1024 * 1024
						)
							return fail(ws, "RESTORE_OUTPUT_LIMIT");
						if (ready) ws.send(new Uint8Array(chunk).buffer);
						else {
							bytes += chunk.byteLength;
							if (bytes > 1024 * 1024) return fail(ws, "RESTORE_BUFFER_LIMIT");
							backlog.push(chunk);
						}
					};
					const tracker = new TerminalModes();
					try {
						daemon = await connectExistingDaemon();
						if (closed) {
							await daemon.dispose();
							return;
						}
						if (!daemon.supportsConditionalSubscribe)
							return fail(ws, "RESTORE_UNSUPPORTED");
						daemon.onDisconnect(() => fail(ws, "DAEMON_UNAVAILABLE"));
						unsubscribe = await daemon.subscribeExisting(
							ref.resourceId,
							ref.executionId!,
							{
								onOutput: output,
								onReplayComplete(modes) {
									tracker.restore(modes);
									const preamble = tracker.buildPreamble();
									if (preamble.byteLength) output(preamble);
								},
								onError(code) {
									fail(
										ws,
										code === "EEXECUTION"
											? "EXECUTION_CHANGED"
											: "RESTORE_UNAVAILABLE",
									);
								},
								onExit(info) {
									if (!closed)
										ws.send(
											JSON.stringify({ type: "exit", exitCode: info.code }),
										);
									cleanup();
									ws.close(1000, "EXECUTION_EXITED");
								},
							},
						);
						if (closed) {
							try {
								unsubscribe();
							} catch {}
							return;
						}
						if (!allowed()) return fail(ws, "RESOURCE_UNAVAILABLE");
						ws.send(
							JSON.stringify({
								type: "attached",
								terminalId: ref.resourceId,
								workspaceId: ref.workspaceId,
								executionId: ref.executionId,
							}),
						);
						ready = true;
						for (const chunk of backlog) ws.send(new Uint8Array(chunk).buffer);
						backlog.length = 0;
					} catch (error) {
						fail(
							ws,
							error instanceof Error && error.message === "EEXECUTION"
								? "EXECUTION_CHANGED"
								: "RESTORE_UNAVAILABLE",
						);
					}
				},
				onMessage(event, ws) {
					if (
						!ready ||
						closed ||
						!daemon ||
						!parsed.success ||
						!parsed.data.executionId
					)
						return;
					try {
						if (
							typeof event.data !== "string" ||
							event.data.length > 1024 * 1024
						)
							return fail(ws, "INVALID_RESTORE_INPUT");
						const message = JSON.parse(event.data);
						const ref = parsed.data;
						if (message.type === "input" && typeof message.data === "string")
							daemon.inputExisting(
								ref.resourceId,
								ref.executionId!,
								Buffer.from(message.data),
							);
						else if (
							message.type === "resize" &&
							Number.isInteger(message.cols) &&
							Number.isInteger(message.rows) &&
							message.cols > 0 &&
							message.cols <= 1000 &&
							message.rows > 0 &&
							message.rows <= 1000
						)
							daemon.resizeExisting(
								ref.resourceId,
								ref.executionId!,
								message.cols,
								message.rows,
							);
					} catch {
						fail(ws, "RESTORE_UNAVAILABLE");
					}
				},
				onClose: cleanup,
				onError: cleanup,
			};
		}),
	);
}

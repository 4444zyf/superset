import { Trans, useLingui } from "@lingui/react/macro";
import {
	displayText,
	emptySnapshot,
	reduce,
	runningTurnId,
	userMessageText,
} from "@superset/chat/core";
import {
	envelopeSchema,
	type Item,
	knownItemSchema,
} from "@superset/chat/protocol";
import { useEffect, useState } from "react";
import type {
	DirectDescriptor,
	DirectWorkstationApi,
} from "../../../../../shared/direct-workstation";

const button =
	"rounded border border-zinc-700 px-3 py-2 text-sm disabled:opacity-40";
const harnessLabels = { codex: "Codex", "claude-code": "Claude Code" } as const;

type DownloadedAttachment = Awaited<
	ReturnType<DirectWorkstationApi["readAttachment"]>
>;

function saveDownloadedAttachment(attachment: DownloadedAttachment): void {
	const url = URL.createObjectURL(
		new Blob([new Uint8Array(attachment.bytes).buffer], {
			type: attachment.mimeType,
		}),
	);
	const link = document.createElement("a");
	link.href = url;
	link.download = attachment.fileName;
	link.hidden = true;
	document.body.append(link);
	try {
		link.click();
	} finally {
		link.remove();
		setTimeout(() => URL.revokeObjectURL(url), 0);
	}
}

export function RemoteChat({
	api,
	connection,
	workspaceId,
	onError,
	saveAttachment = saveDownloadedAttachment,
}: {
	api: DirectWorkstationApi;
	connection: DirectDescriptor;
	workspaceId: string;
	onError(message: string): void;
	saveAttachment?(attachment: DownloadedAttachment): void;
}) {
	const { t } = useLingui();
	const [sessions, setSessions] = useState<
		{ sessionId: string; harness: string }[]
	>([]);
	const [sessionId, setSessionId] = useState<string | null>(null);
	const [harness, setHarness] = useState("codex");
	const [snapshot, setSnapshot] = useState(emptySnapshot);
	const [prompt, setPrompt] = useState("");
	const [busy, setBusy] = useState(false);
	const [attachments, setAttachments] = useState<
		{
			attachmentId: string;
			originalFilename?: string;
			mediaType: string;
			sizeBytes: number;
		}[]
	>([]);
	const available =
		connection.chatHarnesses?.find((candidate) => candidate.id === harness)
			?.available === true;
	const rpc = <T,>(path: string, type: "query" | "mutation", input: unknown) =>
		api.rpc<T>({
			connectionId: connection.connectionId,
			generation: connection.generation,
			path: `chat.${path}`,
			type,
			input,
		});
	const run = async (execute: () => Promise<void>) => {
		setBusy(true);
		try {
			await execute();
		} catch (error) {
			onError(String(error));
		} finally {
			setBusy(false);
		}
	};
	useEffect(() => {
		let active = true;
		void api
			.rpc<{ sessionId: string; harness: string }[]>({
				connectionId: connection.connectionId,
				generation: connection.generation,
				path: "chat.listSessions",
				type: "query",
				input: { workspaceId },
			})
			.then((rows) => {
				if (active) {
					setSessions(rows);
					setSessionId((previous) =>
						rows.some((row) => row.sessionId === previous)
							? previous
							: (rows[0]?.sessionId ?? null),
					);
				}
			})
			.catch((error) => {
				if (active) onError(String(error));
			});
		return () => {
			active = false;
		};
	}, [api, connection, workspaceId, onError]);
	useEffect(() => {
		setSnapshot(emptySnapshot());
		if (!sessionId) return;
		const socketId = crypto.randomUUID();
		let closed = false;
		const off = api.onSocket((message) => {
			if (message.socketId !== socketId || closed) return;
			if (message.kind === "message" && typeof message.data === "string") {
				try {
					const parsed = envelopeSchema.safeParse(JSON.parse(message.data));
					if (parsed.success)
						setSnapshot((previous) => reduce(previous, parsed.data));
				} catch {}
			}
		});
		void api
			.openSocket(connection, `/chat-v3/sessions/${sessionId}/stream`, socketId)
			.then(() => {
				if (closed) return api.closeSocket(socketId).catch(() => {});
			})
			.catch((error) => {
				if (!closed) onError(String(error));
			});
		return () => {
			closed = true;
			off();
			void api.closeSocket(socketId).catch(() => {});
		};
	}, [api, connection, sessionId, onError]);
	const approval = (item: Item, decision: unknown) =>
		run(async () => {
			if (sessionId)
				await rpc("respondToApproval", "mutation", {
					commandId: crypto.randomUUID(),
					sessionId,
					approvalId: item.id,
					decision,
				});
		});
	const downloadAttachment = (attachmentId: string) =>
		run(async () => {
			const downloaded = await api.readAttachment(connection, attachmentId);
			saveAttachment(downloaded);
		});
	return (
		<section className="border border-zinc-700 rounded p-3 space-y-3">
			<div className="flex flex-wrap gap-2">
				<select
					aria-label={t({ message: "Agent" })}
					className="bg-zinc-900 rounded p-2"
					value={harness}
					onChange={(event) => setHarness(event.target.value)}
				>
					<option value="codex">{harnessLabels.codex}</option>
					<option value="claude-code">{harnessLabels["claude-code"]}</option>
				</select>
				<button
					type="button"
					className={button}
					disabled={
						busy || !available || !connection.capabilities?.durableOperations
					}
					onClick={() =>
						void run(async () => {
							const result = await rpc<{ sessionId: string }>(
								"createSession",
								"mutation",
								{ commandId: crypto.randomUUID(), workspaceId, harness },
							);
							setSessions((previous) => [
								...previous,
								{ sessionId: result.sessionId, harness },
							]);
							setSessionId(result.sessionId);
						})
					}
				>
					<Trans>New chat</Trans>
				</button>
				{sessions.map((session, index) => (
					<button
						type="button"
						className={button}
						key={session.sessionId}
						onClick={() => setSessionId(session.sessionId)}
					>
						{session.harness} #{index + 1}
					</button>
				))}
				{runningTurnId(snapshot.turns) && (
					<button
						type="button"
						className={button}
						disabled={busy}
						onClick={() =>
							void run(async () => {
								await rpc("cancelTurn", "mutation", {
									commandId: crypto.randomUUID(),
									sessionId,
									turnId: runningTurnId(snapshot.turns),
								});
							})
						}
					>
						<Trans>Stop</Trans>
					</button>
				)}
			</div>
			{!available && (
				<p className="text-xs text-zinc-400">
					<Trans>
						Install the agent CLI on the remote machine to start a chat.
					</Trans>
				</p>
			)}
			<div className="max-h-96 overflow-auto space-y-3">
				{[...snapshot.items.values()].map(({ item: value }) => {
					const parsed = knownItemSchema.safeParse(value);
					if (!parsed.success) return null;
					const item = parsed.data;
					return (
						<article
							key={item.id}
							className="whitespace-pre-wrap break-words text-sm"
						>
							{item.kind === "user_message"
								? userMessageText(item)
								: item.kind === "agent_message" || item.kind === "reasoning"
									? displayText(snapshot, item.id)
									: item.kind === "notice"
										? item.text
										: item.kind === "tool_call"
											? item.title
											: null}
							{item.kind === "user_message" &&
								item.content
									.filter((part) => part.type === "attachment")
									.map((part) => (
										<button
											type="button"
											key={part.attachmentId}
											className={button}
											disabled={busy}
											onClick={() => void downloadAttachment(part.attachmentId)}
										>
											{part.name}
										</button>
									))}
							{item.kind === "approval_request" && (
								<>
									<p>{item.title}</p>
									{item.status === "pending" && (
										<div className="flex gap-2">
											{item.options?.length ? (
												item.options.map((option) => (
													<button
														type="button"
														key={option.optionId}
														className={button}
														onClick={() =>
															void approval(item, {
																type: "option",
																optionId: option.optionId,
															})
														}
													>
														{option.label}
													</button>
												))
											) : (
												<>
													<button
														type="button"
														className={button}
														onClick={() =>
															void approval(item, { type: "accept" })
														}
													>
														<Trans>Allow</Trans>
													</button>
													<button
														type="button"
														className={button}
														onClick={() =>
															void approval(item, { type: "decline" })
														}
													>
														<Trans>Deny</Trans>
													</button>
												</>
											)}
										</div>
									)}
								</>
							)}
						</article>
					);
				})}
			</div>
			{sessionId && (
				<>
					<div className="flex gap-2 flex-wrap">
						<button
							type="button"
							className={button}
							disabled={busy || attachments.length >= 16}
							onClick={() =>
								void run(async () => {
									const attachment = await api.chooseAttachment(connection);
									if (attachment)
										setAttachments((previous) => [...previous, attachment]);
								})
							}
						>
							<Trans>Attach files</Trans>
						</button>
						{attachments.map((attachment) => (
							<button
								type="button"
								className={button}
								key={attachment.attachmentId}
								onClick={() => void downloadAttachment(attachment.attachmentId)}
							>
								{attachment.originalFilename ?? attachment.attachmentId}
							</button>
						))}
					</div>
					<form
						className="flex gap-2"
						onSubmit={(event) => {
							event.preventDefault();
							if (!prompt.trim() && !attachments.length) return;
							void run(async () => {
								await rpc("prompt", "mutation", {
									commandId: crypto.randomUUID(),
									clientId: crypto.randomUUID(),
									sessionId,
									content: [
										...(prompt.trim() ? [{ type: "text", text: prompt }] : []),
										...attachments.map((attachment) => ({
											type: "attachment",
											attachmentId: attachment.attachmentId,
											name:
												attachment.originalFilename ?? attachment.attachmentId,
											mimeType: attachment.mediaType,
										})),
									],
								});
								setPrompt("");
								setAttachments([]);
							});
						}}
					>
						<textarea
							aria-label={t({ message: "Message" })}
							className="flex-1 bg-zinc-900 rounded p-2 text-sm"
							value={prompt}
							onChange={(event) => setPrompt(event.target.value)}
						/>
						<button
							className={button}
							disabled={busy || !connection.capabilities?.durableOperations}
							type="submit"
						>
							<Trans>Send</Trans>
						</button>
					</form>
				</>
			)}
		</section>
	);
}

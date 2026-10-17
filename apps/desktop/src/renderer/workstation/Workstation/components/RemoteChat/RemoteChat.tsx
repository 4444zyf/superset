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
import { errorMessage } from "@superset/i18n/errors";
import { Button } from "@superset/ui/button";
import { getClipboardFiles } from "@superset/ui/lib/clipboard-files";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { validateClipboardFiles } from "renderer/lib/terminal/clipboard-files";
import type {
	DirectDescriptor,
	DirectWorkstationApi,
} from "../../../../../shared/direct-workstation";

const ChatMarkdown = lazy(() =>
	import("@superset/chat-ui/ChatMarkdown").then((module) => ({
		default: module.ChatMarkdown,
	})),
);

const button =
	"max-w-full min-w-0 truncate rounded border border-border px-3 py-2 text-sm disabled:opacity-40";
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
	selectedSessionId,
	onSessionSelected,
	onAttached,
	onError,
	saveAttachment = saveDownloadedAttachment,
}: {
	api: DirectWorkstationApi;
	connection: DirectDescriptor;
	workspaceId: string;
	selectedSessionId?: string | null;
	onSessionSelected?(id: string | null): void;
	onAttached?(): void;
	onError(message: string): void;
	saveAttachment?(attachment: DownloadedAttachment): void;
}) {
	const { t } = useLingui();
	const callbacks = useRef({ onError, onAttached });
	callbacks.current = { onError, onAttached };
	const [sessions, setSessions] = useState<
		{ sessionId: string; harness: string }[]
	>([]);
	const [localSessionId, setLocalSessionId] = useState<string | null>(null);
	const sessionId =
		selectedSessionId !== undefined ? selectedSessionId : localSessionId;
	const setSessionId = (id: string | null) => {
		if (selectedSessionId === undefined) setLocalSessionId(id);
		onSessionSelected?.(id);
	};
	const [harness, setHarness] = useState("codex");
	const [snapshot, setSnapshot] = useState(emptySnapshot);
	const [prompt, setPrompt] = useState("");
	const [busy, setBusy] = useState(false);
	const [attachmentError, setAttachmentError] = useState<string | null>(null);
	const [attachments, setAttachments] = useState<
		{
			attachmentId: string;
			originalFilename?: string;
			mediaType: string;
			sizeBytes: number;
		}[]
	>([]);
	const mounted = useRef(false);
	const namespaceScope = JSON.stringify([
		connection.connectionId,
		connection.backendId,
		connection.namespaceId,
		workspaceId,
	]);
	const draftScope = JSON.stringify([namespaceScope, sessionId]);
	const operationScope = JSON.stringify([draftScope, connection.generation]);
	const currentScope = useRef({ key: operationScope, epoch: 0 });
	if (currentScope.current.key !== operationScope)
		currentScope.current = {
			key: operationScope,
			epoch: currentScope.current.epoch + 1,
		};
	const operationSequence = useRef(0);
	const operationBusy = useRef<number | null>(null);
	const sessionListVersion = useRef(0);
	const scopeEpoch = currentScope.current.epoch;
	const previousBusyEpoch = useRef(scopeEpoch);
	const previousDraftScope = useRef(draftScope);
	const previousNamespaceScope = useRef(namespaceScope);
	const attachmentsAvailable = connection.capabilities?.attachments === true;
	const sendingAttachmentsAvailable =
		attachmentsAvailable &&
		connection.capabilities?.workstationChatAttachmentInputV1 === true;
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
	const run = async (
		execute: (isCurrent: () => boolean) => Promise<void>,
		recoverable = false,
	) => {
		const epoch = currentScope.current.epoch;
		if (operationBusy.current === epoch) return;
		operationBusy.current = epoch;
		const sequence = ++operationSequence.current;
		const isCurrent = () =>
			mounted.current &&
			currentScope.current.epoch === epoch &&
			operationSequence.current === sequence;
		setBusy(true);
		try {
			await execute(isCurrent);
		} catch (error) {
			if (isCurrent()) {
				if (recoverable) setAttachmentError(errorMessage(error));
				else callbacks.current.onError(String(error));
			}
		} finally {
			if (operationBusy.current === epoch) operationBusy.current = null;
			if (isCurrent()) setBusy(false);
		}
	};
	useEffect(() => {
		mounted.current = true;
		return () => {
			mounted.current = false;
		};
	}, []);
	useEffect(() => {
		if (previousBusyEpoch.current === scopeEpoch) return;
		previousBusyEpoch.current = scopeEpoch;
		setBusy(false);
	}, [scopeEpoch]);
	useEffect(() => {
		if (previousDraftScope.current === draftScope) return;
		previousDraftScope.current = draftScope;
		setPrompt("");
		setAttachments([]);
		setAttachmentError(null);
	}, [draftScope]);
	useEffect(() => {
		if (previousNamespaceScope.current === namespaceScope) return;
		previousNamespaceScope.current = namespaceScope;
		setSessions([]);
		if (selectedSessionId === undefined) setLocalSessionId(null);
	}, [namespaceScope, selectedSessionId]);
	useEffect(() => {
		let active = true;
		const version = ++sessionListVersion.current;
		void api
			.rpc<{ sessionId: string; harness: string }[]>({
				connectionId: connection.connectionId,
				generation: connection.generation,
				path: "chat.listSessions",
				type: "query",
				input: { workspaceId },
			})
			.then((rows) => {
				if (active && sessionListVersion.current === version) {
					setSessions(rows);
					if (selectedSessionId === undefined)
						setLocalSessionId((previous) =>
							rows.some((row) => row.sessionId === previous)
								? previous
								: (rows[0]?.sessionId ?? null),
						);
				}
			})
			.catch((error) => {
				if (active && sessionListVersion.current === version)
					callbacks.current.onError(String(error));
			});
		return () => {
			active = false;
		};
	}, [api, connection, workspaceId, selectedSessionId]);
	useEffect(() => {
		setSnapshot(emptySnapshot());
		if (!sessionId) return;
		const socketId = crypto.randomUUID();
		let closed = false;
		const off = api.onSocket((message) => {
			if (message.socketId !== socketId || closed) return;
			if (message.kind === "open") callbacks.current.onAttached?.();
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
				if (!closed) callbacks.current.onError(String(error));
			});
		return () => {
			closed = true;
			off();
			void api.closeSocket(socketId).catch(() => {});
		};
	}, [api, connection, sessionId]);
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
		run(async (isCurrent) => {
			if (!attachmentsAvailable) return;
			const downloaded = await api.readAttachment(connection, attachmentId);
			if (isCurrent()) saveAttachment(downloaded);
		});
	return (
		<section className="flex h-full min-h-0 min-w-0 flex-col gap-2 overflow-hidden rounded border border-border p-3">
			<div className="flex min-h-0 max-h-24 flex-wrap gap-2 overflow-auto">
				<select
					aria-label={t({ message: "Agent" })}
					className="min-w-0 max-w-full rounded bg-muted p-2"
					value={harness}
					onChange={(event) => setHarness(event.target.value)}
				>
					<option value="codex">{harnessLabels.codex}</option>
					<option value="claude-code">{harnessLabels["claude-code"]}</option>
				</select>
				<Button
					variant="outline"
					size="sm"
					type="button"
					className={button}
					disabled={
						busy || !available || !connection.capabilities?.durableOperations
					}
					onClick={() =>
						void run(async (isCurrent) => {
							const result = await rpc<{ sessionId: string }>(
								"createSession",
								"mutation",
								{ commandId: crypto.randomUUID(), workspaceId, harness },
							);
							if (!isCurrent()) return;
							sessionListVersion.current++;
							setSessions((previous) => [
								...previous,
								{ sessionId: result.sessionId, harness },
							]);
							setSessionId(result.sessionId);
						})
					}
				>
					<Trans>New chat</Trans>
				</Button>
				{sessions.map((session, index) => (
					<Button
						variant="outline"
						size="sm"
						type="button"
						className={button}
						key={session.sessionId}
						onClick={() => setSessionId(session.sessionId)}
					>
						{session.harness} #{index + 1}
					</Button>
				))}
				{runningTurnId(snapshot.turns) && (
					<Button
						variant="outline"
						size="sm"
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
					</Button>
				)}
			</div>
			<div className="min-h-0 flex-1 overflow-auto space-y-3">
				{!available && (
					<p className="text-xs text-muted-foreground">
						<Trans>
							Install the agent CLI on the remote machine to start a chat.
						</Trans>
					</p>
				)}
				{!sendingAttachmentsAvailable && (
					<p className="text-xs text-muted-foreground">
						<Trans>Attachments are unavailable on this backend.</Trans>
					</p>
				)}
				{[...snapshot.items.values()].map(({ item: value }) => {
					const parsed = knownItemSchema.safeParse(value);
					if (!parsed.success) return null;
					const item = parsed.data;
					return (
						<article
							key={item.id}
							className="whitespace-pre-wrap break-words text-sm"
						>
							{item.kind === "user_message" ? (
								userMessageText(item)
							) : item.kind === "agent_message" || item.kind === "reasoning" ? (
								<Suspense fallback={displayText(snapshot, item.id)}>
									<ChatMarkdown>{displayText(snapshot, item.id)}</ChatMarkdown>
								</Suspense>
							) : item.kind === "notice" ? (
								item.text
							) : item.kind === "tool_call" ? (
								item.title
							) : null}
							{item.kind === "user_message" &&
								item.content
									.filter((part) => part.type === "attachment")
									.map((part) => (
										<Button
											variant="outline"
											size="sm"
											type="button"
											key={part.attachmentId}
											className={button}
											disabled={busy || !attachmentsAvailable}
											onClick={() => void downloadAttachment(part.attachmentId)}
										>
											{part.name}
										</Button>
									))}
							{item.kind === "approval_request" && (
								<>
									<p>{item.title}</p>
									{item.status === "pending" && (
										<div className="flex gap-2">
											{item.options?.length ? (
												item.options.map((option) => (
													<Button
														variant="outline"
														size="sm"
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
													</Button>
												))
											) : (
												<>
													<Button
														variant="outline"
														size="sm"
														type="button"
														className={button}
														onClick={() =>
															void approval(item, { type: "accept" })
														}
													>
														<Trans>Allow</Trans>
													</Button>
													<Button
														variant="outline"
														size="sm"
														type="button"
														className={button}
														onClick={() =>
															void approval(item, { type: "decline" })
														}
													>
														<Trans>Deny</Trans>
													</Button>
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
					<div className="flex min-h-0 max-h-24 flex-wrap gap-2 overflow-auto">
						<Button
							variant="outline"
							size="sm"
							type="button"
							className={button}
							disabled={
								busy || !sendingAttachmentsAvailable || attachments.length >= 16
							}
							onClick={() =>
								void run(async (isCurrent) => {
									if (!sendingAttachmentsAvailable) return;
									const attachment = await api.chooseAttachment(connection);
									if (attachment && isCurrent()) {
										validateClipboardFiles(
											[...attachments, attachment].map((a) => ({
												size: a.sizeBytes,
											})),
										);
										setAttachments((previous) => [...previous, attachment]);
									}
								}, true)
							}
						>
							<Trans>Attach files</Trans>
						</Button>
						{attachments.map((attachment) => (
							<Button
								variant="outline"
								size="sm"
								type="button"
								className={button}
								key={attachment.attachmentId}
								disabled={busy || !attachmentsAvailable}
								onClick={() => void downloadAttachment(attachment.attachmentId)}
							>
								{attachment.originalFilename ?? attachment.attachmentId}
							</Button>
						))}
					</div>
					{attachmentError && (
						<output
							role="alert"
							className="max-h-24 shrink-0 overflow-auto text-xs text-destructive"
						>
							{attachmentError}
							<button
								type="button"
								className="ml-2 underline"
								onClick={() => setAttachmentError(null)}
							>
								<Trans>Close</Trans>
							</button>
						</output>
					)}
					<form
						className="flex shrink-0 flex-wrap gap-2"
						onSubmit={(event) => {
							event.preventDefault();
							if (!prompt.trim() && !attachments.length) return;
							if (attachments.length && !sendingAttachmentsAvailable) return;
							if (attachments.length) {
								try {
									validateClipboardFiles(
										attachments.map((a) => ({ size: a.sizeBytes })),
									);
								} catch (error) {
									setAttachmentError(errorMessage(error));
									return;
								}
							}
							void run(async (isCurrent) => {
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
								if (!isCurrent()) return;
								setPrompt("");
								setAttachments([]);
							}, true);
						}}
					>
						<textarea
							aria-label={t({ message: "Message" })}
							className="min-w-0 grow basis-40 resize-none rounded bg-muted p-2 text-sm"
							readOnly={busy}
							value={prompt}
							onPaste={(event) => {
								const files = getClipboardFiles(event.clipboardData);
								if (!files.length) return;
								event.preventDefault();
								if (busy) return;
								setAttachmentError(null);
								void run(async (isCurrent) => {
									validateClipboardFiles([
										...attachments.map((a) => ({ size: a.sizeBytes })),
										...files,
									]);
									if (!sendingAttachmentsAvailable || !api.uploadAttachment)
										throw new Error(
											"This backend does not support the required capability",
										);
									for (const file of files) {
										const bytes = new Uint8Array(await file.arrayBuffer());
										if (!isCurrent()) return;
										const attachment = await api.uploadAttachment(connection, {
											bytes,
											fileName: file.name || "image.png",
											mimeType: file.type || "application/octet-stream",
										});
										if (!isCurrent()) return;
										if (attachment)
											setAttachments((previous) => [...previous, attachment]);
									}
								}, true);
							}}
							onChange={(event) => setPrompt(event.target.value)}
						/>
						<Button
							variant="outline"
							size="sm"
							className={button}
							disabled={
								busy ||
								!connection.capabilities?.durableOperations ||
								(attachments.length > 0 && !sendingAttachmentsAvailable)
							}
							type="submit"
						>
							<Trans>Send</Trans>
						</Button>
					</form>
				</>
			)}
		</section>
	);
}

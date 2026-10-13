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
import { useEffect, useRef, useState } from "react";
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
	const sessionListVersion = useRef(0);
	const scopeEpoch = currentScope.current.epoch;
	const previousBusyEpoch = useRef(scopeEpoch);
	const previousDraftScope = useRef(draftScope);
	const previousNamespaceScope = useRef(namespaceScope);
	const attachmentsAvailable = connection.capabilities?.attachments === true;
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
	const run = async (execute: (isCurrent: () => boolean) => Promise<void>) => {
		const epoch = currentScope.current.epoch;
		const sequence = ++operationSequence.current;
		const isCurrent = () =>
			mounted.current &&
			currentScope.current.epoch === epoch &&
			operationSequence.current === sequence;
		setBusy(true);
		try {
			await execute(isCurrent);
		} catch (error) {
			if (isCurrent()) callbacks.current.onError(String(error));
		} finally {
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
	}, [draftScope]);
	useEffect(() => {
		if (previousNamespaceScope.current === namespaceScope) return;
		previousNamespaceScope.current = namespaceScope;
		setSessions([]);
		if (selectedSessionId === undefined) setLocalSessionId(null);
	}, [namespaceScope]);
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
	}, [api, connection, workspaceId]);
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
			{!attachmentsAvailable && (
				<p className="text-xs text-zinc-400">
					<Trans>Attachments are unavailable on this backend.</Trans>
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
											disabled={busy || !attachmentsAvailable}
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
							disabled={
								busy || !attachmentsAvailable || attachments.length >= 16
							}
							onClick={() =>
								void run(async (isCurrent) => {
									if (!attachmentsAvailable) return;
									const attachment = await api.chooseAttachment(connection);
									if (attachment && isCurrent())
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
								disabled={busy || !attachmentsAvailable}
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
							if (attachments.length && !attachmentsAvailable) return;
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
							});
						}}
					>
						<textarea
							aria-label={t({ message: "Message" })}
							className="flex-1 bg-zinc-900 rounded p-2 text-sm"
							readOnly={busy}
							value={prompt}
							onChange={(event) => setPrompt(event.target.value)}
						/>
						<button
							className={button}
							disabled={
								busy ||
								!connection.capabilities?.durableOperations ||
								(attachments.length > 0 && !attachmentsAvailable)
							}
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

import { randomUUID } from "node:crypto";
import type {
	SDKUserMessage,
	query as sdkQuery,
} from "@anthropic-ai/claude-agent-sdk";
import type {
	ApprovalRequest,
	Decision,
	UserContent,
} from "@superset/chat/protocol";
import {
	attachmentReference,
	INLINE_IMAGE_TYPES,
	PromptAttachmentQueue,
	type ResolvedPromptContent,
	type ResolvePromptAttachment,
} from "../../attachments/attachments";
import type {
	AdapterEvent,
	HarnessAdapter,
	HarnessStartOptions,
} from "../../types";
import { ClaudeTranslator } from "../translateStream";

type SdkParams = Parameters<typeof sdkQuery>[0];
type SdkOptions = NonNullable<SdkParams["options"]>;

/**
 * Input positions are the SDK's own types: widening them (a bare `string`
 * permissionMode, an `AsyncIterable<unknown>` prompt) type-checks against the
 * real `query` only through a cast, and the cast is what hid the mismatch.
 */
export type ClaudeQueryOptions = Pick<
	SdkOptions,
	| "abortController"
	| "allowDangerouslySkipPermissions"
	| "canUseTool"
	| "cwd"
	| "env"
	| "includePartialMessages"
	| "model"
	| "pathToClaudeCodeExecutable"
	| "permissionMode"
	| "resume"
	| "settingSources"
>;

type PermissionResult = Awaited<
	ReturnType<NonNullable<SdkOptions["canUseTool"]>>
>;

type ClaudePermissionMode = NonNullable<SdkOptions["permissionMode"]>;

export type ClaudeSession = AsyncIterable<unknown> & {
	interrupt?: () => Promise<unknown>;
	setPermissionMode?: (mode: ClaudePermissionMode) => Promise<unknown>;
};

export const CLAUDE_MODES = [
	{ id: "default", label: "Ask for approval" },
	{ id: "acceptEdits", label: "Approve edits" },
	{ id: "auto", label: "Approve for me" },
	{ id: "plan", label: "Plan" },
	{ id: "bypassPermissions", label: "Full access" },
] as const satisfies readonly { id: ClaudePermissionMode; label: string }[];

export const DEFAULT_CLAUDE_MODE: ClaudePermissionMode = "bypassPermissions";

function claudeMode(modeId: string | undefined): ClaudePermissionMode {
	return CLAUDE_MODES.find((mode) => mode.id === modeId)?.id ?? "default";
}

export type ClaudeQuery = (params: {
	prompt: SdkParams["prompt"];
	options: ClaudeQueryOptions;
}) => ClaudeSession;

export type ClaudeLaunch = {
	pathToClaudeCodeExecutable?: string;
	env?: ClaudeQueryOptions["env"];
};

export type ClaudeAdapterOptions = {
	resolveAttachment?: ResolvePromptAttachment;
	query: ClaudeQuery;
	pathToClaudeCodeExecutable?: string;
	launch?: () => Promise<ClaudeLaunch>;
	now?: () => number;
	mintId?: () => string;
};

type PendingApproval = {
	toolUseId: string;
	input: Record<string, unknown>;
	settle: (result: PermissionResult) => void;
};

class EventQueue {
	private readonly buffered: AdapterEvent[] = [];
	private waiting: ((result: IteratorResult<AdapterEvent>) => void) | null =
		null;
	private closed = false;

	push(event: AdapterEvent): void {
		if (this.closed) return;
		const waiting = this.waiting;
		if (waiting) {
			this.waiting = null;
			waiting({ value: event, done: false });
			return;
		}
		this.buffered.push(event);
	}

	close(): void {
		if (this.closed) return;
		this.closed = true;
		const waiting = this.waiting;
		if (waiting) {
			this.waiting = null;
			waiting({ value: undefined, done: true });
		}
	}

	next(): Promise<IteratorResult<AdapterEvent>> {
		const buffered = this.buffered.shift();
		if (buffered) return Promise.resolve({ value: buffered, done: false });
		if (this.closed) return Promise.resolve({ value: undefined, done: true });
		return new Promise((resolve) => {
			this.waiting = resolve;
		});
	}
}

class PromptQueue {
	private readonly buffered: SDKUserMessage[] = [];
	private waiting: ((result: IteratorResult<SDKUserMessage>) => void) | null =
		null;
	private closed = false;

	push(message: SDKUserMessage): void {
		if (this.closed) return;
		const waiting = this.waiting;
		if (waiting) {
			this.waiting = null;
			waiting({ value: message, done: false });
			return;
		}
		this.buffered.push(message);
	}

	close(): void {
		this.closed = true;
		this.discardPending();
		const waiting = this.waiting;
		if (waiting) {
			this.waiting = null;
			waiting({ value: undefined, done: true });
		}
	}

	discardPending(): boolean {
		return this.buffered.splice(0).length > 0;
	}

	async *stream(): AsyncIterable<SDKUserMessage> {
		while (true) {
			const buffered = this.buffered.shift();
			if (buffered) {
				yield buffered;
				continue;
			}
			if (this.closed) return;
			const next = await new Promise<IteratorResult<SDKUserMessage>>(
				(resolve) => {
					this.waiting = resolve;
				},
			);
			if (next.done) return;
			yield next.value;
		}
	}
}

function promptText(content: UserContent[]): string {
	return content
		.map((part) => (part.type === "text" ? part.text : `[${part.name}]`))
		.join("\n");
}

export class ClaudeAdapter implements HarnessAdapter {
	private readonly events = new EventQueue();
	private readonly prompts = new PromptQueue();
	private readonly approvals = new Map<string, PendingApproval>();
	private readonly abortController = new AbortController();
	private translator: ClaudeTranslator | null = null;
	private session: ClaudeSession | null = null;
	private sessionId: string | null = null;
	private modeId: ClaudePermissionMode = "default";
	private pump: Promise<void> | null = null;
	private disposed = false;
	private readonly attachmentQueue?: PromptAttachmentQueue;
	private inputClosed = false;

	constructor(private readonly options: ClaudeAdapterOptions) {
		if (options.resolveAttachment)
			this.attachmentQueue = new PromptAttachmentQueue({
				resolve: options.resolveAttachment,
				deliver: (content) => {
					if (!this.disposed)
						this.prompts.push({
							type: "user",
							message: { role: "user", content: this.toSdkContent(content) },
							parent_tool_use_id: null,
						});
				},
				fail: (error) =>
					this.finishPreparation(
						"failed",
						error instanceof Error ? error.message : String(error),
					),
			});
	}

	start(startOptions: HarnessStartOptions): AsyncIterable<AdapterEvent> {
		const translator = new ClaudeTranslator({
			cwd: startOptions.cwd,
			now: this.options.now,
			mintId: this.options.mintId,
		});
		this.translator = translator;

		this.modeId = claudeMode(
			startOptions.modeId ??
				(startOptions.resume ? undefined : DEFAULT_CLAUDE_MODE),
		);
		this.events.push({
			kind: "session",
			session: { modeId: this.modeId, availableModes: [...CLAUDE_MODES] },
		});
		void this.begin(startOptions, translator);
		const events = this.events;
		return {
			[Symbol.asyncIterator](): AsyncIterator<AdapterEvent> {
				return { next: () => events.next() };
			},
		};
	}

	private async begin(
		startOptions: HarnessStartOptions,
		translator: ClaudeTranslator,
	): Promise<void> {
		let launch: ClaudeLaunch | undefined;
		try {
			launch = await this.options.launch?.();
		} catch (error) {
			if (this.attachmentQueue) {
				this.attachmentQueue.cancel();
				this.inputClosed = true;
				this.finishPreparation(
					"failed",
					error instanceof Error ? error.message : String(error),
				);
				this.events.push({ kind: "session", session: { status: "dead" } });
				this.events.close();
				return;
			}
			for (const event of translator.interrupt(
				error instanceof Error ? error.message : String(error),
			)) {
				this.events.push(event);
			}
			this.events.close();
			return;
		}
		if (this.disposed) return;

		const stream = this.options.query({
			prompt: this.prompts.stream(),
			options: {
				cwd: startOptions.cwd,
				model: startOptions.modelId,
				pathToClaudeCodeExecutable:
					launch?.pathToClaudeCodeExecutable ??
					this.options.pathToClaudeCodeExecutable,
				env: launch?.env,
				includePartialMessages: true,
				settingSources: [],
				permissionMode: this.modeId,
				allowDangerouslySkipPermissions: true,
				abortController: this.abortController,
				resume: startOptions.resume?.harnessSessionId,
				canUseTool: (_toolName, input, { toolUseID }) =>
					this.requestApproval(input, toolUseID),
			},
		});

		this.session = stream;
		this.pump = this.run(stream, translator);
	}

	prompt(content: UserContent[]): void {
		if (this.disposed) return;
		if (this.inputClosed) throw new Error("Agent session has ended");
		if (this.attachmentQueue) {
			this.attachmentQueue.enqueue(content);
			return;
		}
		this.prompts.push({
			type: "user",
			message: { role: "user", content: promptText(content) },
			parent_tool_use_id: null,
		});
	}

	cancelTurn(): void {
		const preparing = this.attachmentQueue?.cancel();
		const buffered = this.attachmentQueue && this.prompts.discardPending();
		if (preparing || buffered) {
			this.finishPreparation("interrupted");
			return;
		}
		const interrupt = this.session?.interrupt;
		if (!interrupt) {
			this.abortController.abort();
			return;
		}
		this.translator?.markInterrupted("Turn canceled by user");
		void interrupt.call(this.session).catch(() => {
			this.abortController.abort();
		});
	}

	respondToApproval(approvalId: string, decision: Decision): void {
		const pending = this.approvals.get(approvalId);
		if (!pending) return;
		this.approvals.delete(approvalId);

		if (decision.type === "accept" || decision.type === "accept_for_session") {
			pending.settle({ behavior: "allow", updatedInput: pending.input });
		} else {
			this.translator?.markDeclined(pending.toolUseId);
			pending.settle({
				behavior: "deny",
				message: "User declined this tool call.",
				...(decision.type === "cancel" ? { interrupt: true } : {}),
			});
		}

		this.emitApproval(approvalId, pending.toolUseId, "answered", decision);
		if (decision.type === "cancel") this.cancelTurn();
	}

	setMode(modeId: string): void {
		const previous = this.modeId;
		const next = claudeMode(modeId);
		this.modeId = next;
		this.events.push({ kind: "session", session: { modeId: next } });
		void this.session?.setPermissionMode?.(next).catch(() => {
			if (this.modeId !== next) return;
			this.modeId = previous;
			this.events.push({ kind: "session", session: { modeId: previous } });
		});
	}

	async dispose(): Promise<void> {
		this.disposed = true;
		this.attachmentQueue?.cancel();
		for (const [approvalId, pending] of [...this.approvals]) {
			this.approvals.delete(approvalId);
			pending.settle({ behavior: "deny", message: "Session disposed." });
		}
		this.abortController.abort();
		this.prompts.close();
		await this.pump;
		this.events.close();
	}

	private toSdkContent(
		content: ResolvedPromptContent[],
	): SDKUserMessage["message"]["content"] {
		return content.map((part) => {
			if (part.type === "text") return { type: "text", text: part.text };
			const attachment = part.resolvedAttachment;
			if (!attachment) throw new Error("Attachment resolution is missing");
			if (INLINE_IMAGE_TYPES.has(attachment.mimeType))
				return {
					type: "image",
					source: {
						type: "base64",
						media_type: attachment.mimeType as
							| "image/png"
							| "image/jpeg"
							| "image/gif"
							| "image/webp",
						data: attachment.data,
					},
				};
			if (attachment.mimeType === "application/pdf")
				return {
					type: "document",
					source: {
						type: "base64",
						media_type: "application/pdf",
						data: attachment.data,
					},
				};
			return {
				type: "text",
				text: attachmentReference(part.name, attachment.path),
			};
		});
	}

	private finishPreparation(
		status: "failed" | "interrupted",
		message?: string,
	): void {
		if (this.disposed) return;
		const now = (this.options.now ?? Date.now)();
		const id = (this.options.mintId ?? randomUUID)();
		if (message)
			this.events.push({
				kind: "item",
				turnId: id,
				item: {
					id: (this.options.mintId ?? randomUUID)(),
					kind: "notice",
					noticeKind: "error",
					text: message,
					startedAtMs: now,
					completedAtMs: now,
				},
			});
		this.events.push({
			kind: "turn",
			inputNotDelivered: true,
			turn: {
				id,
				status,
				startedAtMs: now,
				completedAtMs: now,
				...(message ? { error: { message } } : {}),
			},
		});
		this.events.push({ kind: "session", session: { status: "idle" } });
	}

	private async run(
		stream: AsyncIterable<unknown>,
		translator: ClaudeTranslator,
	): Promise<void> {
		try {
			for await (const message of stream) {
				if (this.disposed) return;
				this.reportSessionId(message);
				for (const event of translator.translate(message)) {
					this.events.push(event);
				}
			}
		} catch (error) {
			for (const event of translator.interrupt(String(error))) {
				this.events.push(event);
			}
		} finally {
			if (this.attachmentQueue && !this.disposed) {
				this.inputClosed = true;
				if (this.attachmentQueue.cancel())
					this.finishPreparation(
						"failed",
						"Agent session ended before message delivery",
					);
				this.events.push({ kind: "session", session: { status: "dead" } });
				this.prompts.close();
			}
		}
	}

	private reportSessionId(message: unknown): void {
		if (typeof message !== "object" || message === null) return;
		const sessionId = (message as { session_id?: unknown }).session_id;
		if (typeof sessionId !== "string" || sessionId === this.sessionId) return;
		this.sessionId = sessionId;
		this.events.push({
			kind: "session",
			session: { harnessSessionId: sessionId },
		});
	}

	private requestApproval(
		input: Record<string, unknown>,
		toolUseId: string,
	): Promise<PermissionResult> {
		const approvalId = this.mintId();
		return new Promise<PermissionResult>((settle) => {
			this.approvals.set(approvalId, { toolUseId, input, settle });
			this.emitApproval(approvalId, toolUseId, "pending");
		});
	}

	private emitApproval(
		approvalId: string,
		toolUseId: string,
		status: ApprovalRequest["status"],
		decision?: Decision,
	): void {
		const item: ApprovalRequest = {
			id: approvalId,
			kind: "approval_request",
			startedAtMs: this.now(),
			...(status === "pending" ? {} : { completedAtMs: this.now() }),
			targetItemId: toolUseId,
			title: "Allow this tool call?",
			status,
			...(decision ? { decision } : {}),
		};
		this.events.push({
			kind: "item",
			item,
			turnId: this.translator?.currentTurnId ?? "unattributed",
		});
	}

	private now(): number {
		return (this.options.now ?? Date.now)();
	}

	private mintId(): string {
		return (this.options.mintId ?? randomUUID)();
	}
}

import type { UserContent } from "@superset/chat/protocol";

export type PromptAttachment = { path: string; mimeType: string; data: string };
export type ResolvePromptAttachment = (
	id: string,
	signal: AbortSignal,
) => Promise<PromptAttachment | null>;
export type ResolvedPromptContent = UserContent & {
	resolvedAttachment?: PromptAttachment;
};

export const MAX_PROMPT_ATTACHMENTS = 16;
export const MAX_PROMPT_ATTACHMENT_BYTES = 25 * 1024 * 1024;
export const INLINE_IMAGE_TYPES = new Set([
	"image/png",
	"image/jpeg",
	"image/gif",
	"image/webp",
]);

export function attachmentReference(name: string, path: string): string {
	return `Attachment ${JSON.stringify(name)}: ${JSON.stringify(path)}`;
}

export class PromptAttachmentQueue {
	private sequence = Promise.resolve();
	private controller = new AbortController();
	private pending = 0;

	constructor(
		private readonly options: {
			resolve: ResolvePromptAttachment;
			deliver(content: ResolvedPromptContent[]): void;
			fail(error: unknown): void;
			maxBytes?: number;
		},
	) {}

	enqueue(content: UserContent[]): void {
		const signal = this.controller.signal;
		this.pending++;
		this.sequence = this.sequence.then(async () => {
			if (signal.aborted) return;
			let settled = false;
			try {
				if (
					content.filter((part) => part.type === "attachment").length >
					MAX_PROMPT_ATTACHMENTS
				)
					throw new Error("Too many attachments in one message");
				const prepared: ResolvedPromptContent[] = [];
				let totalBytes = 0;
				for (const part of content) {
					signal.throwIfAborted();
					if (part.type === "text") {
						prepared.push(part);
						continue;
					}
					const attachment = await this.options.resolve(
						part.attachmentId,
						signal,
					);
					signal.throwIfAborted();
					if (!attachment)
						throw new Error(
							`Could not read attachment ${JSON.stringify(part.name)}`,
						);
					const length = attachment.data.length;
					const bytes =
						(length / 4) * 3 -
						(attachment.data.endsWith("==")
							? 2
							: attachment.data.endsWith("=")
								? 1
								: 0);
					totalBytes += bytes;
					if (
						bytes <= 0 ||
						totalBytes > (this.options.maxBytes ?? MAX_PROMPT_ATTACHMENT_BYTES)
					)
						throw new Error(
							"Attachments exceed the message byte limit or are empty",
						);
					prepared.push({ ...part, resolvedAttachment: attachment });
				}
				this.pending--;
				settled = true;
				this.options.deliver(prepared);
			} catch (error) {
				if (signal.aborted) return;
				if (!settled) this.pending--;
				this.options.fail(error);
			}
		});
	}

	cancel(): boolean {
		const pending = this.pending > 0;
		this.pending = 0;
		this.controller.abort();
		this.controller = new AbortController();
		this.sequence = Promise.resolve();
		return pending;
	}
}
